import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GameScreen from '../src/components/GameScreen.vue';
import LobbyScreen from '../src/components/LobbyScreen.vue';
import OwnCardsModal from '../src/components/OwnCardsModal.vue';
import { createAppI18n } from '../src/i18n';
import { blankCard, filledTips, isBlank, isComplete, MY_CARDS_KEY, readMyCards, toOwnCard, writeMyCards, type MyCard } from '../src/myCards';
import { createStore } from '../src/store';
import { FakeSocket, lobbyView, makeView, MemoryStorage } from './helpers';

const full = (answer = 'Teapot'): MyCard => ({
  ...blankCard(),
  category: 'thing',
  answer,
  aliases: 'tea pot, , bule ',
  tips: Array.from({ length: 20 }, (_, i) => `${answer} tip ${i + 1}`),
});

function setup() {
  const socket = new FakeSocket();
  const store = createStore(socket, new MemoryStorage(), () => 'en', 50);
  return { socket, store, global: { plugins: [createAppI18n('en')] } };
}

const saved = () => readMyCards(localStorage);

beforeEach(() => localStorage.clear());

describe('cards written by the player', () => {
  it('start empty, with 20 tips to fill', () => {
    const card = blankCard();
    expect(card.tips).toHaveLength(20);
    expect(filledTips(card)).toBe(0);
    expect(isBlank(card)).toBe(true);
    expect(isComplete(card)).toBe(false);
    expect(blankCard().id).not.toBe(card.id);
  });

  it('can be played once they have an answer and all 20 tips', () => {
    const card = full();
    expect(isComplete(card)).toBe(true);
    expect(isComplete({ ...card, answer: '  ' })).toBe(false);
    expect(isComplete({ ...card, tips: [...card.tips.slice(0, 19), ' '] })).toBe(false);
    expect(filledTips({ ...card, tips: [...card.tips.slice(0, 19), ' '] })).toBe(19);
  });

  it('are sent to the server tidied up', () => {
    const card = { ...full(), answer: '  Teapot ' };
    card.tips[0] = '  I am hot.  ';
    expect(toOwnCard(card)).toEqual({
      category: 'thing',
      answer: 'Teapot',
      aliases: ['tea pot', 'bule'],
      tips: ['I am hot.', ...card.tips.slice(1)],
    });
  });

  it('are kept in the browser, and read back whatever state the saved data is in', () => {
    const storage = new MemoryStorage();
    expect(readMyCards(storage)).toEqual([]);
    writeMyCards(storage, [full('A'), full('B')]);
    expect(readMyCards(storage).map((c) => c.answer)).toEqual(['A', 'B']);
    storage.setItem(MY_CARDS_KEY, '{broken');
    expect(readMyCards(storage)).toEqual([]);
    storage.setItem(MY_CARDS_KEY, JSON.stringify([null, { answer: 'Half', tips: ['one'], category: 'animal' }, 'x']));
    const [card] = readMyCards(storage);
    expect(card).toMatchObject({ answer: 'Half', category: 'thing', aliases: '' });
    expect(card.tips).toHaveLength(20);
    expect(card.tips[0]).toBe('one');
    expect(readMyCards(storage)).toHaveLength(1);
  });
});

describe('the window of own cards', () => {
  const open = (canUse = true) => {
    const { global } = setup();
    return mount(OwnCardsModal, { props: { canUse }, global });
  };

  it('says so when there are none, and lets the player write one', async () => {
    const wrapper = open();
    expect(wrapper.get('[data-test="own-empty"]').text()).toBe('You have not written any card yet.');
    await wrapper.get('[data-test="own-new"]').trigger('click');
    expect(wrapper.find('[data-test="own-form"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="own-tip"]')).toHaveLength(20);
    expect(wrapper.get('[data-test="own-category"]').findAll('option').map((o) => o.text())).toEqual(['Thing', 'Person', 'Place', 'Year']);
  });

  it('saves what is typed at once, and only lets a finished card be used', async () => {
    const wrapper = open();
    await wrapper.get('[data-test="own-new"]').trigger('click');
    await wrapper.get('[data-test="own-category"]').setValue('place');
    await wrapper.get('[data-test="own-answer"]').setValue('My street');
    const tips = wrapper.findAll('[data-test="own-tip"]');
    for (let i = 0; i < 19; i++) await tips[i].setValue(`Street tip ${i + 1}`);
    expect(wrapper.get('[data-test="own-progress"]').text()).toBe('19 of 20 tips');
    expect(wrapper.get('[data-test="own-use-this"]').attributes('disabled')).toBeDefined();
    expect(saved()[0]).toMatchObject({ category: 'place', answer: 'My street' }); // already in the browser
    expect(saved()[0].tips[18]).toBe('Street tip 19');

    await tips[19].setValue('Street tip 20');
    expect(wrapper.get('[data-test="own-use-this"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-test="own-use-this"]').trigger('click');
    expect(wrapper.emitted('use')![0][0]).toMatchObject({ category: 'place', answer: 'My street', aliases: [] });
    expect((wrapper.emitted('use')![0][0] as { tips: string[] }).tips).toHaveLength(20);
  });

  it('lists the saved cards, to use, change or delete', async () => {
    writeMyCards(localStorage, [full('Teapot'), { ...full('Draft'), tips: blankCard().tips }]);
    const wrapper = open();
    const rows = wrapper.findAll('[data-test="own-card"]');
    expect(rows.map((r) => r.text())).toEqual([
      'ThingTeapot20 of 20 tipsUse this cardEditDelete',
      'ThingDraft0 of 20 tipsUse this cardEditDelete',
    ]);
    expect(rows[1].get('[data-test="own-use"]').attributes('disabled')).toBeDefined(); // not finished
    await rows[0].get('[data-test="own-use"]').trigger('click');
    expect(wrapper.emitted('use')![0][0]).toMatchObject({ answer: 'Teapot', aliases: ['tea pot', 'bule'] });

    await rows[1].get('[data-test="own-edit"]').trigger('click');
    expect((wrapper.get('[data-test="own-answer"]').element as HTMLInputElement).value).toBe('Draft');
    await wrapper.get('[data-test="own-answer"]').setValue('Better name');
    await wrapper.get('[data-test="own-form"]').trigger('submit');
    expect(saved().map((c) => c.answer)).toEqual(['Teapot', 'Better name']);

    // deleting asks once more
    const del = wrapper.findAll('[data-test="own-delete"]')[0];
    await del.trigger('click');
    expect(del.text()).toBe('Really delete?');
    expect(saved()).toHaveLength(2);
    await del.trigger('click');
    await nextTick();
    expect(saved().map((c) => c.answer)).toEqual(['Better name']);
  });

  it('does not keep a card left completely empty', async () => {
    const wrapper = open();
    await wrapper.get('[data-test="own-new"]').trigger('click');
    await wrapper.get('[data-test="own-done"]').trigger('submit');
    await nextTick();
    expect(wrapper.find('[data-test="own-empty"]').exists()).toBe(true);
    expect(saved()).toEqual([]);
  });

  it('outside a round, only writes and keeps cards', () => {
    writeMyCards(localStorage, [full()]);
    const wrapper = open(false);
    expect(wrapper.find('[data-test="own-use"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="own-edit"]').exists()).toBe(true);
  });
});

describe('playing an own card', () => {
  const choosing = () => {
    const v = makeView({ you: 'a', phase: 'choosing' });
    v.round!.revealed = [];
    v.round!.cardChosen = false;
    v.round!.answer = 'Paris';
    return v;
  };

  it('is offered to the card holder while choosing the card, and sends the card to the server', async () => {
    writeMyCards(localStorage, [full('Teapot')]);
    const s = setup();
    const wrapper = mount(GameScreen, { props: { store: s.store, view: choosing() }, global: s.global });
    expect(wrapper.find('[data-test="own-modal"]').exists()).toBe(false);
    await wrapper.get('[data-test="own-cards"]').trigger('click');
    await wrapper.get('[data-test="own-use"]').trigger('click');
    expect(s.socket.last()).toMatchObject({ event: 'game:useOwnCard', payload: { category: 'thing', answer: 'Teapot' } });
    s.socket.last().reply({ ok: true, data: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.find('[data-test="own-modal"]').exists()).toBe(false);
  });

  it('is not offered once the card is chosen, nor to the other players', () => {
    const s = setup();
    const chosen = choosing();
    chosen.round!.cardChosen = true;
    expect(mount(GameScreen, { props: { store: s.store, view: chosen }, global: s.global }).find('[data-test="own-cards"]').exists()).toBe(false);
    const other = { ...choosing(), you: 'b' };
    expect(mount(GameScreen, { props: { store: s.store, view: other }, global: s.global }).find('[data-test="own-cards"]').exists()).toBe(false);
  });

  it('tells everybody that the card was written by the card holder', () => {
    const s = setup();
    const v = makeView({ you: 'c' });
    v.round!.ownCard = true;
    const wrapper = mount(GameScreen, { props: { store: s.store, view: v }, global: s.global });
    expect(wrapper.get('[data-test="own-note"]').text()).toContain('This card was written by Ana.');
    expect(mount(GameScreen, { props: { store: s.store, view: makeView() }, global: s.global }).find('[data-test="own-note"]').exists()).toBe(false);
  });

  it('can be prepared in the room before the game', async () => {
    const s = setup();
    const wrapper = mount(LobbyScreen, { props: { store: s.store, view: lobbyView('b') }, global: s.global });
    await wrapper.get('[data-test="own-cards"]').trigger('click');
    expect(wrapper.find('[data-test="own-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="own-new"]').exists()).toBe(true);
  });
});

describe('filling a card automatically', () => {
  const tips = (n: number) => Array.from({ length: n }, (_, i) => `Generated tip ${i + 1}`);
  let calls: { url: string; body?: any }[];

  /** Makes the game server answer like it would with an AI service behind it. */
  function serverAnswers(available: boolean, ...replies: (object | Error)[]) {
    calls = [];
    let n = 0;
    (globalThis as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      // (jsdom has no Response: an object with json() is all the code uses)
      if (!init || init.method !== 'POST') return { json: async () => ({ available }) };
      const reply = replies[Math.min(n++, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return { json: async () => JSON.parse(JSON.stringify(reply)) };
    });
  }
  afterEach(() => delete (globalThis as any).fetch);

  const flushAll = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  async function openForm(locale: 'en' | 'pt-BR' = 'en') {
    const wrapper = mount(OwnCardsModal, { props: { canUse: true }, global: { plugins: [createAppI18n(locale)] } });
    await flushAll();
    await wrapper.get('[data-test="own-new"]').trigger('click');
    return wrapper;
  }
  const values = (w: ReturnType<typeof mount>, test: string) => w.findAll(`[data-test="${test}"]`).map((i) => (i.element as HTMLInputElement).value);

  it('is offered only when the server has an AI service set up', async () => {
    serverAnswers(false);
    expect((await openForm()).find('[data-test="own-generate"]').exists()).toBe(false);
    serverAnswers(true);
    expect((await openForm()).find('[data-test="own-generate"]').exists()).toBe(true);
  });

  it('fills the answer, the other answers and the 20 tips, in the player’s language and category', async () => {
    serverAnswers(true, { ok: true, complete: true, card: { answer: 'Teapot', aliases: ['tea pot', 'kettle'], tips: tips(20) } });
    const wrapper = await openForm('pt-BR');
    await wrapper.get('[data-test="own-category"]').setValue('thing');
    await wrapper.get('[data-test="own-generate"]').trigger('click');
    await flushAll();
    expect(calls[1]).toEqual({ url: '/api/cards/generate', body: { category: 'thing', locale: 'pt-BR' } });
    expect((wrapper.get('[data-test="own-answer"]').element as HTMLInputElement).value).toBe('Teapot');
    expect((wrapper.get('[data-test="own-aliases"]').element as HTMLInputElement).value).toBe('tea pot, kettle');
    expect(values(wrapper, 'own-tip')).toEqual(tips(20));
    expect(wrapper.get('[data-test="own-generate-message"]').text()).toContain('Carta preenchida');
    expect(wrapper.get('[data-test="own-use-this"]').attributes('disabled')).toBeUndefined();
    expect(saved()[0].tips).toEqual(tips(20)); // kept in the browser like anything typed
  });

  it('writes the card for the answer the player typed', async () => {
    serverAnswers(true, { ok: true, complete: true, card: { answer: 'Grandma', aliases: [], tips: tips(20) } });
    const wrapper = await openForm();
    await wrapper.get('[data-test="own-category"]').setValue('person');
    await wrapper.get('[data-test="own-answer"]').setValue('Grandma');
    await wrapper.get('[data-test="own-generate"]').trigger('click');
    await flushAll();
    expect(calls[1].body).toEqual({ category: 'person', answer: 'Grandma', locale: 'en' });
  });

  it('says when fewer than 20 tips came back, and leaves the rest to write', async () => {
    serverAnswers(true, { ok: true, complete: false, card: { answer: 'Teapot', aliases: [], tips: tips(14) } });
    const wrapper = await openForm();
    await wrapper.get('[data-test="own-generate"]').trigger('click');
    await flushAll();
    expect(values(wrapper, 'own-tip').filter(Boolean)).toHaveLength(14);
    expect(wrapper.get('[data-test="own-progress"]').text()).toBe('14 of 20 tips');
    expect(wrapper.get('[data-test="own-generate-message"]').text()).toBe('Only 14 usable tips came back: write the rest yourself, or try again.');
    expect(wrapper.get('[data-test="own-use-this"]').attributes('disabled')).toBeDefined();
  });

  it('explains each way it can fail, and leaves the form as it was', async () => {
    const cases: [object | Error, string][] = [
      [{ ok: false, error: { code: 'badOutput' } }, 'The AI did not write a usable card.'],
      [{ ok: false, error: { code: 'providerBusy' } }, 'The AI service is busy'],
      [{ ok: false, error: { code: 'providerRejected' } }, "the server's key or model setting may be wrong"],
      [{ ok: false, error: { code: 'rateLimited' } }, 'Wait a minute'],
      [{ ok: false, error: { code: 'notConfigured' } }, 'not set up on this server'],
      [{ ok: false, error: { code: 'somethingNew' } }, 'could not be reached'],
      [{ ok: true, card: { answer: 'X' } }, 'could not be reached'], // a reply without tips
      [new TypeError('Failed to fetch'), 'The game server could not be reached.'],
    ];
    for (const [reply, message] of cases) {
      serverAnswers(true, reply);
      const wrapper = await openForm();
      await wrapper.get('[data-test="own-answer"]').setValue('Mine');
      await wrapper.get('[data-test="own-generate"]').trigger('click');
      await flushAll();
      expect(wrapper.get('[data-test="own-generate-message"]').text()).toContain(message);
      expect((wrapper.get('[data-test="own-answer"]').element as HTMLInputElement).value).toBe('Mine');
      expect(values(wrapper, 'own-tip').filter(Boolean)).toHaveLength(0);
      wrapper.unmount();
      localStorage.clear();
    }
  });

  it('asks before replacing tips the player already wrote', async () => {
    serverAnswers(true, { ok: true, complete: true, card: { answer: 'Teapot', aliases: [], tips: tips(20) } });
    const wrapper = await openForm();
    await wrapper.findAll('[data-test="own-tip"]')[0].setValue('My own first tip');
    const button = wrapper.get('[data-test="own-generate"]');
    await button.trigger('click');
    expect(button.text()).toBe('Replace the tips you wrote?');
    expect(calls.filter((c) => c.body)).toHaveLength(0);
    await button.trigger('click');
    await flushAll();
    expect(calls.filter((c) => c.body)).toHaveLength(1);
    expect(values(wrapper, 'own-tip')[0]).toBe('Generated tip 1');
  });
});

