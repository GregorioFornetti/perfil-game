import { defaultScoring } from '../src/types';
import { createStore, NAME_KEY, readSeenCards, readSession, SEEN_KEY, SESSION_KEY } from '../src/store';
import { FakeSocket, flush, makeView, MemoryStorage } from './helpers';

function setup() {
  const socket = new FakeSocket();
  const storage = new MemoryStorage();
  const store = createStore(socket, storage, () => 'pt-BR', 50);
  return { socket, storage, store };
}

const joined = { ok: true, data: { code: 'ABCD', playerId: 'b', token: 'secret' } };

describe('store', () => {
  it('creates a room, remembers the seat and the name', async () => {
    const { socket, storage, store } = setup();
    const done = store.createRoom('Bob');
    expect(socket.last()).toMatchObject({ event: 'room:create', payload: { name: 'Bob', locale: 'pt-BR' } });
    socket.last().reply(joined);
    expect(await done).toBe(true);
    expect(readSession(storage)).toEqual({ code: 'ABCD', token: 'secret' });
    expect(storage.getItem(NAME_KEY)).toBe('Bob');
  });

  it('shows the server’s message when an action is refused', async () => {
    const { socket, storage, store } = setup();
    const done = store.joinRoom('ZZZZ', 'Bob');
    expect(socket.last()).toMatchObject({ event: 'room:join', payload: { code: 'ZZZZ', name: 'Bob' } });
    socket.last().reply({ ok: false, error: { code: 'roomNotFound', message: 'Não existe sala com esse código.' } });
    expect(await done).toBe(false);
    expect(store.state.error).toEqual({ text: 'Não existe sala com esse código.' });
    expect(readSession(storage)).toBeNull();
    store.clearError();
    expect(store.state.error).toBeNull();
  });

  it('keeps the latest state the server sends', () => {
    const { socket, store } = setup();
    expect(store.state.view).toBeNull();
    socket.receive('state', makeView());
    expect(store.state.view?.code).toBe('ABCD');
  });

  it('sends game actions with the right payloads', () => {
    const { socket, store } = setup();
    void store.setColor('pink');
    expect(socket.last()).toMatchObject({ event: 'player:setColor', payload: { color: 'pink' } });
    const settings = { goal: 30, specials: { individual: 1, back: 0, forward: 2, dead: 1, win: 0 }, scoring: defaultScoring(), timers: { tip: 30, guess: 0 }, boardMode: 'random' as const, customBoard: [] };
    void store.configure(settings);
    expect(socket.last()).toMatchObject({ event: 'game:configure', payload: settings });
    void store.start();
    expect(socket.last()).toMatchObject({ event: 'game:start', payload: {} });
    void store.chooseTip(7);
    expect(socket.last()).toMatchObject({ event: 'game:chooseTip', payload: { index: 7 } });
    void store.guess('Paris');
    expect(socket.last()).toMatchObject({ event: 'game:guess', payload: { text: 'Paris' } });
    void store.pass();
    expect(socket.last()).toMatchObject({ event: 'game:pass', payload: undefined });
    void store.acceptGuess(3);
    expect(socket.last()).toMatchObject({ event: 'game:acceptGuess', payload: { guessId: 3 } });
    void store.nextRound();
    expect(socket.last().event).toBe('game:nextRound');
    const own = { category: 'thing' as const, answer: 'Teapot', tips: Array.from({ length: 20 }, (_, i) => `tip ${i}`) };
    void store.useOwnCard(own);
    expect(socket.last()).toMatchObject({ event: 'game:useOwnCard', payload: own });
    void store.chooseCard();
    expect(socket.last().event).toBe('game:chooseCard');
    void store.skipCard();
    expect(socket.last().event).toBe('game:skipCard');
    void store.skipIndividual();
    expect(socket.last().event).toBe('game:skipIndividual');
    void store.playAgain();
    expect(socket.last().event).toBe('game:playAgain');
    void store.setLocale('en');
    expect(socket.last()).toMatchObject({ event: 'locale:set', payload: { locale: 'en' } });
  });

  it('complains when the server does not answer', async () => {
    const { store } = setup();
    const reply = await store.pass();
    expect(reply.ok).toBe(false);
    expect(store.state.error).toEqual({ key: 'connection.noReply' });
  });

  it('takes its seat back when the connection returns', async () => {
    const { socket, storage, store } = setup();
    storage.setItem(SESSION_KEY, JSON.stringify({ code: 'ABCD', token: 'secret' }));
    socket.receive('disconnect');
    expect(store.state.connected).toBe(false);
    socket.receive('connect');
    expect(store.state.connected).toBe(true);
    expect(store.state.restoring).toBe(true);
    expect(socket.last()).toMatchObject({ event: 'room:join', payload: { code: 'ABCD', token: 'secret' } });
    socket.last().reply(joined);
    await flush();
    expect(store.state.restoring).toBe(false);
    expect(readSession(storage)).toEqual({ code: 'ABCD', token: 'secret' });
  });

  it('forgets a room that no longer exists, without an error message', async () => {
    const socket = new FakeSocket();
    const storage = new MemoryStorage();
    storage.setItem(SESSION_KEY, JSON.stringify({ code: 'GONE', token: 'secret' }));
    const store = createStore(socket, storage, () => 'en', 50); // already connected: restores at once
    expect(socket.last().event).toBe('room:join');
    socket.last().reply({ ok: false, error: { code: 'roomNotFound', message: 'There is no room with that code.' } });
    await flush();
    expect(readSession(storage)).toBeNull();
    expect(store.state.error).toBeNull();
  });

  it('leaves a room and forgets it', async () => {
    const { socket, storage, store } = setup();
    storage.setItem(SESSION_KEY, JSON.stringify({ code: 'ABCD', token: 'secret' }));
    socket.receive('state', makeView());
    const done = store.leave();
    expect(socket.last().event).toBe('room:leave');
    socket.last().reply({ ok: true, data: null });
    await done;
    expect(store.state.view).toBeNull();
    expect(readSession(storage)).toBeNull();
  });

  it('goes back to the start when the server says the seat is gone', () => {
    const { socket, storage, store } = setup();
    storage.setItem(SESSION_KEY, JSON.stringify({ code: 'ABCD', token: 'secret' }));
    socket.receive('state', makeView());
    socket.receive('left');
    expect(store.state.view).toBeNull();
    expect(readSession(storage)).toBeNull();
  });

  it('ignores a damaged saved session', () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_KEY, '{not json');
    expect(readSession(storage)).toBeNull();
    storage.setItem(SESSION_KEY, '{"code":1}');
    expect(readSession(storage)).toBeNull();
  });
});

describe('cards already seen', () => {
  it('are sent to the server when creating or joining a room', () => {
    const socket = new FakeSocket();
    const storage = new MemoryStorage();
    storage.setItem(SEEN_KEY, JSON.stringify(['place-paris', 'year-1969']));
    const store = createStore(socket, storage, () => 'en', 50);
    void store.createRoom('Ana');
    expect(socket.last().payload).toMatchObject({ name: 'Ana', seenCards: ['place-paris', 'year-1969'] });
    void store.joinRoom('ABCD', 'Ana');
    expect(socket.last().payload).toMatchObject({ code: 'ABCD', seenCards: ['place-paris', 'year-1969'] });
  });

  it('are kept in the browser as the server reports them, including when it empties the list', () => {
    const socket = new FakeSocket();
    const storage = new MemoryStorage();
    createStore(socket, storage, () => 'en', 50);
    socket.receive('state', makeView({ seenCards: ['place-paris'] }));
    expect(readSeenCards(storage)).toEqual(['place-paris']);
    socket.receive('state', makeView({ seenCards: [] })); // every card seen: start again
    expect(readSeenCards(storage)).toEqual([]);
  });

  it('survive a damaged saved list', () => {
    const storage = new MemoryStorage();
    storage.setItem(SEEN_KEY, '{oops');
    expect(readSeenCards(storage)).toEqual([]);
    storage.setItem(SEEN_KEY, JSON.stringify(['a', 3, null, 'b']));
    expect(readSeenCards(storage)).toEqual(['a', 'b']);
  });
});

