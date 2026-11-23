import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import GameBoard from '../src/components/GameBoard.vue';
import GameOptionsModal from '../src/components/GameOptionsModal.vue';
import GameScreen from '../src/components/GameScreen.vue';
import TurnTimer from '../src/components/TurnTimer.vue';
import HomeScreen from '../src/components/HomeScreen.vue';
import LobbyScreen from '../src/components/LobbyScreen.vue';
import { createAppI18n } from '../src/i18n';
import { createStore } from '../src/store';
import { defaultScoring, type GameView, type Locale } from '../src/types';
import { FakeSocket, individualView, lobbyView, makeView, MemoryStorage } from './helpers';

function setup(locale: Locale = 'en') {
  const socket = new FakeSocket();
  const store = createStore(socket, new MemoryStorage(), () => locale, 50);
  const i18n = createAppI18n(locale);
  return { socket, store, global: { plugins: [i18n] }, i18n };
}

const game = (view: GameView, locale: Locale = 'en') => {
  const s = setup(locale);
  return { ...s, wrapper: mount(GameScreen, { props: { store: s.store, view }, global: s.global }) };
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

describe('HomeScreen', () => {
  it('creates a room once a name is typed', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(HomeScreen, { props: { store }, global });
    expect(wrapper.get('[data-test="create"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="name"]').setValue('  Ana ');
    await wrapper.get('[data-test="create"]').trigger('click');
    expect(socket.last()).toMatchObject({ event: 'room:create', payload: { name: 'Ana' } });
  });

  it('joins a room by code', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(HomeScreen, { props: { store }, global });
    expect(wrapper.get('[data-test="join"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="name"]').setValue('Bob');
    await wrapper.get('[data-test="code"]').setValue('wxyz');
    await wrapper.get('form').trigger('submit');
    expect(socket.last()).toMatchObject({ event: 'room:join', payload: { code: 'wxyz', name: 'Bob' } });
  });

  it('opened from an invite link, offers only joining that room, as the main action', async () => {
    window.location.hash = '#wxyz';
    const { socket, store, global } = setup();
    const wrapper = mount(HomeScreen, { props: { store }, global, attachTo: document.body });
    expect(wrapper.get('[data-test="invite"]').text()).toContain('WXYZ');
    expect(wrapper.find('[data-test="create"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="code"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="join"]').text()).toBe('Join room WXYZ');
    expect(wrapper.get('[data-test="join"]').classes()).toContain('btn-primary');
    expect(document.activeElement).toBe(wrapper.get('[data-test="name"]').element);
    await wrapper.get('[data-test="name"]').setValue('Bob');
    await wrapper.get('form').trigger('submit');
    expect(socket.last()).toMatchObject({ event: 'room:join', payload: { code: 'WXYZ', name: 'Bob' } });
    wrapper.unmount();
  });

  it('picks up an invite link opened in a tab already showing the start screen', async () => {
    const { store, global } = setup();
    const wrapper = mount(HomeScreen, { props: { store }, global, attachTo: document.body });
    expect(wrapper.find('[data-test="invite"]').exists()).toBe(false);
    window.location.hash = '#QRST';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await nextTick();
    await nextTick();
    expect(wrapper.get('[data-test="invite"]').text()).toContain('QRST');
    expect(wrapper.get('[data-test="join"]').text()).toBe('Join room QRST');
    wrapper.unmount();
  });

  it('lets an invited visitor go back to the normal start screen', async () => {
    window.location.hash = '#wxyz';
    const { store, global } = setup();
    const wrapper = mount(HomeScreen, { props: { store }, global });
    await wrapper.get('[data-test="not-invited"]').trigger('click');
    expect(wrapper.find('[data-test="create"]').exists()).toBe(true);
    expect((wrapper.get('[data-test="code"]').element as HTMLInputElement).value).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('explains the rules in the chosen language', () => {
    const { store, global } = setup('pt-BR');
    const wrapper = mount(HomeScreen, { props: { store }, global });
    expect(wrapper.text()).toContain('Como jogar');
    expect(wrapper.findAll('ol li')).toHaveLength(7);
  });
});

describe('LobbyScreen', () => {
  it('shows the code and players, and lets the host start', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(LobbyScreen, { props: { store, view: lobbyView('a') }, global });
    expect(wrapper.get('[data-test="room-code"]').text()).toBe('ABCD');
    expect(wrapper.findAll('[data-test="player"]').map((p) => p.text())).toEqual(['AAnayouhost', 'BBob', 'CCyaway']);
    expect(wrapper.findAll('[data-test="player"] [data-test="token"]').map((t) => t.attributes('data-color'))).toEqual(['red', 'blue', 'green']);
    await wrapper.get('[data-test="start"]').trigger('click');
    expect(socket.last()).toMatchObject({ event: 'game:start', payload: {} });
  });

  it('lets each player pick a token colour nobody else has', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(LobbyScreen, { props: { store, view: lobbyView('b') }, global }); // Ana red, Bob blue, Cy green
    const swatch = (color: string) => wrapper.get(`[data-test="color"][data-color="${color}"]`);
    expect(wrapper.findAll('[data-test="color"]')).toHaveLength(12);
    expect(swatch('blue').attributes('aria-checked')).toBe('true');
    expect(swatch('blue').attributes('disabled')).toBeUndefined();
    expect(swatch('red').attributes('disabled')).toBeDefined();
    expect(swatch('red').attributes('title')).toBe('Red – taken by Ana');
    expect(swatch('green').attributes('disabled')).toBeDefined();
    expect(swatch('pink').attributes('disabled')).toBeUndefined();
    const before = socket.sent.length;
    await swatch('red').trigger('click'); // taken: nothing happens
    await swatch('blue').trigger('click'); // already mine: nothing to send
    expect(socket.sent.length).toBe(before);
    await swatch('pink').trigger('click');
    expect(socket.last()).toMatchObject({ event: 'player:setColor', payload: { color: 'pink' } });
  });

  it('makes the other players wait for the host', () => {
    const { store, global } = setup();
    const wrapper = mount(LobbyScreen, { props: { store, view: lobbyView('b') }, global });
    expect(wrapper.find('[data-test="start"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="waiting-host"]').text()).toBe('Waiting for Ana to start the game…');
  });

  it('does not let the host start alone', () => {
    const { store, global } = setup();
    const view = lobbyView('a');
    view.players = view.players.slice(0, 1);
    const wrapper = mount(LobbyScreen, { props: { store, view }, global });
    expect(wrapper.get('[data-test="start"]').attributes('disabled')).toBeDefined();
  });
});

describe('GameScreen', () => {
  it('lets the player on turn pick one of the hidden tips', async () => {
    const { wrapper, socket } = game(makeView());
    expect(wrapper.get('[data-test="status"]').text()).toBe('Your turn: pick a tip number.');
    expect(wrapper.get('[data-test="category"]').text()).toBe('I am a place');
    expect(wrapper.get('[data-test="holder"]').text()).toContain('Ana holds the card');
    const picks = wrapper.findAll('[data-test="pick"]');
    expect(picks).toHaveLength(19);
    expect(wrapper.findAll('[data-test="tip"]').map((t) => t.text())).toEqual(['4I am made of iron.']);
    expect(wrapper.find('[data-test="secret"]').exists()).toBe(false);
    await picks[4].trigger('click'); // tips 1,2,3,5,6... -> the fifth button is tip 6
    expect(socket.last()).toMatchObject({ event: 'game:chooseTip', payload: { index: 5 } });
  });

  it('shows the guess box after a tip, and sends a guess or a pass', async () => {
    const { wrapper, socket } = game(makeView({ phase: 'guessing' }));
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('A right guess now is worth 19 spaces');
    expect(wrapper.get('[data-test="guess"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="guess-input"]').setValue(' Eiffel Tower ');
    await wrapper.get('form').trigger('submit');
    expect(socket.last()).toMatchObject({ event: 'game:guess', payload: { text: 'Eiffel Tower' } });
    await wrapper.get('[data-test="pass"]').trigger('click');
    expect(socket.last().event).toBe('game:pass');
  });

  it('only lets the others watch while somebody else plays', () => {
    const { wrapper } = game(makeView({ you: 'c', phase: 'guessing' }));
    expect(wrapper.get('[data-test="status"]').text()).toBe('Bob is thinking about a guess…');
    expect(wrapper.find('[data-test="guess-input"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test="tip"]')).toHaveLength(20);
    expect(wrapper.find('[data-test="accept"]').exists()).toBe(false);
  });

  it('shows the card holder the answer and lets them count a guess as right', async () => {
    const view = makeView({ you: 'a' });
    view.round!.answer = 'Eiffel Tower';
    view.round!.tips = view.round!.tips.map((t, i) => t ?? `Secret tip ${i + 1}`);
    const { wrapper, socket } = game(view);
    expect(wrapper.get('[data-test="secret"]').text()).toContain('Eiffel Tower');
    expect(wrapper.get('[data-test="holder"]').text()).toContain('You hold the card');
    expect(wrapper.text()).toContain('Secret tip 20');
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(wrapper.get('[data-test="guess-entry"]').text()).toContain('Big Ben');
    await wrapper.get('[data-test="accept"]').trigger('click');
    expect(socket.last()).toMatchObject({ event: 'game:acceptGuess', payload: { guessId: 1 } });
  });

  it('shows the result of a round in Portuguese and who moves', async () => {
    const view = makeView({
      phase: 'roundEnd',
      you: 'a',
      result: { kind: 'normal' as const, solverId: null, effects: [], reason: 'guessed', answer: 'Torre Eiffel', holderId: 'a', winnerId: 'b', tipsUsed: 5, guesserPoints: 15, holderPoints: 5 },
    });
    const { wrapper, socket } = game(view, 'pt-BR');
    expect(wrapper.get('[data-test="result"]').text()).toContain('Bob acertou depois de 5 dicas!');
    expect(wrapper.get('[data-test="answer"]').text()).toBe('Torre Eiffel');
    expect(wrapper.findAll('[data-test="move"]').map((m) => m.text())).toEqual(['Bob avança 15 casas', 'Ana avança 5 casas']);
    await wrapper.get('[data-test="next"]').trigger('click');
    expect(socket.last().event).toBe('game:nextRound');
  });

  it('does not offer "next round" to a player who is neither host nor card holder', () => {
    const view = makeView({
      phase: 'roundEnd',
      you: 'b',
      result: { kind: 'normal' as const, solverId: null, effects: [], reason: 'noTipsLeft', answer: 'Eiffel Tower', holderId: 'a', winnerId: null, tipsUsed: 20, guesserPoints: 0, holderPoints: 20 },
    });
    const { wrapper } = game(view);
    expect(wrapper.find('[data-test="next"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="result"]').text()).toContain('Nobody got it!');
    expect(wrapper.findAll('[data-test="move"]').map((m) => m.text())).toEqual(['Ana moves 20 spaces']);
  });

  it('announces the winner and lets the host play again', async () => {
    const view = makeView({
      phase: 'finished',
      you: 'a',
      winnerId: 'b',
      result: { kind: 'normal' as const, solverId: null, effects: [], reason: 'guessed', answer: 'Eiffel Tower', holderId: 'a', winnerId: 'b', tipsUsed: 2, guesserPoints: 18, holderPoints: 2 },
    });
    const { wrapper, socket } = game(view);
    expect(wrapper.get('[data-test="finished"]').text()).toContain('Bob wins!');
    expect(wrapper.find('[data-test="next"]').exists()).toBe(false);
    await wrapper.get('[data-test="again"]').trigger('click');
    expect(socket.last().event).toBe('game:playAgain');
  });

  it('lists players from first to last on the track, with their tokens', () => {
    const { wrapper } = game(makeView());
    const rows = wrapper.findAll('[data-test="score"]');
    expect(rows[0].text()).toContain('Bob');
    expect(rows[0].text()).toContain('15');
    expect(rows[0].get('[data-test="token"]').attributes('data-color')).toBe('blue');
    expect(rows[2].text()).toContain('Cy');
    expect(rows[2].text()).toContain('away');
  });

  it('shows the board', () => {
    const { wrapper } = game(makeView());
    expect(wrapper.find('[data-test="board"]').exists()).toBe(true);
  });
});

describe('GameBoard', () => {
  const board = (view: GameView) => {
    const s = setup();
    return mount(GameBoard, { props: { view }, global: s.global });
  };

  it('draws every space from the start to the goal', () => {
    const wrapper = board(makeView({ goal: 30, specials: [] }));
    const spaces = wrapper.findAll('[data-test="space"]');
    expect(spaces).toHaveLength(31);
    expect(spaces[0].text()).toBe('➜');
    expect(spaces[7].text()).toBe('7');
    expect(spaces[30].text()).toBe('🏁');
  });

  it('puts a token with the initial and colour of each player on their space', () => {
    const wrapper = board(makeView()); // Ana 5 red, Bob 15 blue, Cy 0 green
    const tokens = wrapper.findAll('[data-test="board-token"]');
    expect(tokens.map((t) => [t.text(), t.attributes('data-space'), t.get('[data-test="token"]').attributes('data-color')])).toEqual([
      ['A', '5', 'red'],
      ['B', '15', 'blue'],
      ['C', '0', 'green'],
    ]);
    // jsdom is 1024 wide: 21 spaces per row for a goal of 60, so space 5 is the sixth of the first of three rows
    expect(tokens[0].attributes('style')).toContain('left: 26.19%');
    expect(tokens[0].attributes('style')).toContain('top: 16.667%');
  });

  it('moves a token when the player advances', async () => {
    const wrapper = board(makeView());
    const view = makeView();
    view.players[0].position = 25; // second row runs right to left: space 25 is the 17th column
    await wrapper.setProps({ view });
    const ana = wrapper.findAll('[data-test="board-token"]')[0];
    expect(ana.attributes('data-space')).toBe('25');
    expect(ana.attributes('style')).toContain('left: 78.571%');
    expect(ana.attributes('style')).toContain('top: 50%');
  });
});

describe('App', () => {
  it('moves from the home screen to the lobby to the game as the server sends states', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(App, { props: { store }, global });
    expect(wrapper.find('[data-test="create"]').exists()).toBe(true);
    socket.receive('state', lobbyView('a'));
    await nextTick();
    expect(wrapper.find('[data-test="room-code"]').exists()).toBe(true);
    socket.receive('state', makeView());
    await nextTick();
    expect(wrapper.find('[data-test="status"]').exists()).toBe(true);
  });

  it('switches language, remembers it and tells the server', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(App, { props: { store }, global });
    expect(wrapper.text()).toContain('Create a room');
    await wrapper.get('[data-test="language"]').setValue('pt-BR');
    expect(wrapper.text()).toContain('Criar uma sala');
    expect(socket.last()).toMatchObject({ event: 'locale:set', payload: { locale: 'pt-BR' } });
    expect(localStorage.getItem('twenty-tips.locale')).toBe('pt-BR');
    expect(document.title).toBe('20 Dicas');
  });

  it('shows refusals from the server and a notice while offline', async () => {
    const { socket, store, global } = setup();
    const wrapper = mount(App, { props: { store }, global });
    expect(wrapper.find('[data-test="offline"]').exists()).toBe(false);
    socket.receive('disconnect');
    await nextTick();
    expect(wrapper.get('[data-test="offline"]').text()).toContain('Connecting');
    void store.pass();
    socket.last().reply({ ok: false, error: { code: 'notYourTurn', message: 'It is not your turn.' } });
    await nextTick();
    expect(wrapper.get('[data-test="error"]').text()).toBe('It is not your turn.');
  });
});

describe('special spaces', () => {
  it('marks them on the board and explains them below it', () => {
    const s = setup();
    const wrapper = mount(GameBoard, { props: { view: makeView() }, global: s.global });
    const spaces = wrapper.findAll('[data-test="space"]');
    expect(spaces[7].text()).toBe('7❓');
    expect(spaces[12].text()).toBe('12−5');
    expect(spaces[20].text()).toBe('20+5');
    expect(spaces[33].text()).toBe('33💀');
    expect(spaces[41].text()).toBe('41🏆');
    expect(spaces[8].text()).toBe('8');
    expect(spaces[33].get('[data-special]').attributes('title')).toBe('33 – Dead place: go back to the start.');
    const legend = wrapper.get('[data-test="legend"]');
    expect(legend.findAll('li').map((li) => li.attributes('data-kind'))).toEqual(['individual', 'back', 'forward', 'dead', 'win']);
    expect(legend.text()).toContain('Instant win – go to the finish and win!');
    expect(legend.text()).toContain('Special spaces only count when you land on them by moving in a normal round');
  });

  it('says at the end of a round what the special spaces did, and what comes next', async () => {
    const view = makeView({
      phase: 'roundEnd',
      you: 'a',
      pendingIndividual: ['b'],
      result: {
        kind: 'normal',
        solverId: null,
        reason: 'guessed',
        answer: 'Paris',
        holderId: 'a',
        winnerId: 'b',
        tipsUsed: 13,
        guesserPoints: 7,
        holderPoints: 13,
        effects: [
          { playerId: 'b', kind: 'individual', from: 7, to: 7 },
          { playerId: 'a', kind: 'back', from: 18, to: 13 },
        ],
      },
    });
    const { wrapper, socket } = game(view);
    expect(wrapper.findAll('[data-test="effect"]').map((e) => e.text())).toEqual([
      'Bob landed on an individual question, played before the next round.',
      'Ana landed on “Move back 5”: 18 → 13',
    ]);
    expect(wrapper.get('[data-test="upcoming"]').text()).toBe("Next: Bob's individual question");
    expect(wrapper.get('[data-test="next"]').text()).toBe("Start Bob's individual question");
    await wrapper.get('[data-test="next"]').trigger('click');
    expect(socket.last().event).toBe('game:nextRound');
  });

  it('translates what happened', () => {
    const view = makeView({
      phase: 'finished',
      winnerId: 'b',
      result: {
        kind: 'normal',
        solverId: null,
        reason: 'guessed',
        answer: 'Paris',
        holderId: 'a',
        winnerId: 'b',
        tipsUsed: 2,
        guesserPoints: 18,
        holderPoints: 2,
        effects: [{ playerId: 'b', kind: 'win', from: 41, to: 60 }],
      },
    });
    const { wrapper } = game(view, 'pt-BR');
    expect(wrapper.get('[data-test="effect"]').text()).toBe('Bob caiu em “Vitória instantânea”!');
    expect(wrapper.get('[data-test="finished"]').text()).toContain('Você venceu!');
  });
});

describe('individual question', () => {
  it('lets the player answering pick tips and guess, with what a right answer is worth', async () => {
    const { wrapper, socket } = game(individualView('b'));
    expect(wrapper.get('[data-test="round-badge"]').text()).toContain('Individual question');
    expect(wrapper.get('[data-test="individual-about"]').text()).toContain('Bob answers this card alone, with up to 5 tips');
    expect(wrapper.get('[data-test="status"]').text()).toBe('Your individual question: pick a tip (1 of 5 used).');
    expect(wrapper.text()).toContain('1 of 5 shown');
    expect(wrapper.text()).toContain('A right guess now is worth 8 spaces'); // 1 tip shown, picking the 2nd
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(19);
    await wrapper.findAll('[data-test="pick"]')[0].trigger('click');
    expect(socket.last()).toMatchObject({ event: 'game:chooseTip', payload: { index: 0 } });
  });

  it('stops offering tips after the fifth', () => {
    const { wrapper } = game({ ...individualView('b', [0, 1, 2, 3, 4]), phase: 'guessing' });
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('A right guess now is worth 2 spaces');
    expect(wrapper.find('[data-test="guess-input"]').exists()).toBe(true);
  });

  it('lets the others only watch, and shows the card to the player drawn to hold it', () => {
    const other = game(individualView('c'));
    expect(other.wrapper.get('[data-test="status"]').text()).toBe('Bob is answering an individual question (1 of 5 tips used).');
    expect(other.wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(other.wrapper.text()).not.toContain('worth');
    const view = individualView('a');
    view.round!.answer = 'Paris';
    const holder = game(view);
    expect(holder.wrapper.get('[data-test="secret"]').text()).toContain('Paris');
    expect(holder.wrapper.get('[data-test="holder"]').text()).toContain('You hold the card');
  });

  it('lets the host or the card holder skip the question while its player is away', async () => {
    const away = (you: string) => {
      const v = individualView(you);
      v.players[1].connected = false;
      return v;
    };
    const holder = game(away('a')); // Ana holds the card and is the host
    expect(holder.wrapper.get('[data-test="status"]').text()).toBe('Waiting for a player to come back…');
    await holder.wrapper.get('[data-test="skip"]').trigger('click');
    expect(holder.socket.last().event).toBe('game:skipIndividual');
    expect(game(away('c')).wrapper.find('[data-test="skip"]').exists()).toBe(false);
    expect(game(individualView('a')).wrapper.find('[data-test="skip"]').exists()).toBe(false); // Bob is here
  });

  it('reports the result of an individual question', () => {
    const result = { kind: 'individual' as const, solverId: 'b', effects: [], answer: 'Paris', holderId: 'a', tipsUsed: 2, holderPoints: 0 };
    const right = game({ ...individualView('b'), phase: 'roundEnd', result: { ...result, reason: 'guessed', winnerId: 'b', guesserPoints: 8 } });
    expect(right.wrapper.get('[data-test="result"] h2').text()).toBe('Bob got the individual question after 2 tips!');
    expect(right.wrapper.findAll('[data-test="move"]').map((m) => m.text())).toEqual(['Bob moves 8 spaces']);
    expect(right.wrapper.find('[data-test="next"]').exists()).toBe(true); // Bob may go on
    const missed = game({ ...individualView('c'), phase: 'roundEnd', result: { ...result, reason: 'noTipsLeft', winnerId: null, guesserPoints: 0, tipsUsed: 5 } }, 'pt-BR');
    expect(missed.wrapper.get('[data-test="result"] h2').text()).toBe('Bob não acertou a pergunta individual em 5 dicas.');
    expect(missed.wrapper.findAll('[data-test="move"]')).toHaveLength(0);
  });
});

describe('game options', () => {
  const counts = (w: ReturnType<typeof mount>) =>
    w.findAll('[data-test="count"]').map((i) => Number((i.element as HTMLInputElement).value));
  const modal = (view = lobbyView('a')) => {
    const s = setup();
    const wrapper = mount(GameOptionsModal, { props: { store: s.store, view }, global: s.global, attachTo: document.body });
    return { ...s, wrapper };
  };

  it('shows everybody the options of the next game, but only the host can change them', async () => {
    const view = lobbyView('b');
    view.settings = { goal: 30, specials: { individual: 2, back: 0, forward: 1, dead: 1, win: 1 }, scoring: defaultScoring(), timers: { tip: 0, guess: 0 }, boardMode: 'random', customBoard: [] };
    const { store, global } = setup();
    const guest = mount(LobbyScreen, { props: { store, view }, global });
    expect(guest.get('[data-test="summary-goal"]').text()).toBe('Board of 30 spaces');
    expect(guest.findAll('[data-test="summary-special"]').map((s) => s.text())).toEqual(['❓2', '−50', '+51', '💀1', '🏆1']);
    expect(guest.find('[data-test="open-options"]').exists()).toBe(false);
    expect(guest.get('[data-test="summary-points"]').text()).toBe('Standard points');
    await guest.get('[data-test="see-options"]').trigger('click');
    const seen = guest.get('[data-test="options-modal"]');
    expect(seen.find('[data-test="options-save"]').exists()).toBe(false);
    expect(seen.findAll('input').every((i) => i.attributes('disabled') !== undefined)).toBe(true);
    expect(seen.get('[data-test="options-goal"]').attributes('disabled')).toBeDefined();
    await seen.get('[data-test="options-cancel"]').trigger('click');
    expect(guest.find('[data-test="options-modal"]').exists()).toBe(false);

    const host = mount(LobbyScreen, { props: { store, view: { ...view, you: 'a' } }, global });
    expect(host.find('[data-test="options-modal"]').exists()).toBe(false);
    await host.get('[data-test="open-options"]').trigger('click');
    expect(host.find('[data-test="options-modal"]').exists()).toBe(true);
    await host.get('[data-test="options-cancel"]').trigger('click');
    expect(host.find('[data-test="options-modal"]').exists()).toBe(false);
  });

  it('opens with the current options', () => {
    const { wrapper } = modal();
    expect((wrapper.get('[data-test="options-goal"]').element as HTMLSelectElement).value).toBe('60');
    expect(counts(wrapper)).toEqual([3, 2, 2, 1, 1]);
    expect(wrapper.get('[data-test="options-used"]').text()).toBe('9 of the 59 spaces between the start and the finish are special.');
    expect(document.activeElement).toBe(wrapper.get('[data-test="options-goal"]').element);
    wrapper.unmount();
  });

  it('puts the special spaces back to the defaults whenever the board size changes', async () => {
    const { wrapper } = modal();
    await wrapper.findAll('[data-test="more"]')[3].trigger('click'); // one more dead place
    await wrapper.findAll('[data-test="less"]')[0].trigger('click'); // one less individual question
    expect(counts(wrapper)).toEqual([2, 2, 2, 2, 1]);
    await wrapper.get('[data-test="options-goal"]').setValue('30');
    expect(counts(wrapper)).toEqual([1, 1, 1, 1, 1]);
    await wrapper.get('[data-test="options-goal"]').setValue('150');
    expect(counts(wrapper)).toEqual([8, 6, 6, 1, 1]);
    expect(wrapper.findAll('[data-test="options-special"]')[0].text()).toContain('default: 8');
    wrapper.unmount();
  });

  it('never lets the special spaces outnumber the spaces of the board', async () => {
    const { wrapper } = modal();
    await wrapper.get('[data-test="options-goal"]').setValue('30'); // 29 spaces can be special; defaults use 5
    const inputs = wrapper.findAll('[data-test="count"]');
    await inputs[0].setValue('999'); // individual questions: only 25 more fit
    await inputs[0].trigger('change');
    expect(counts(wrapper)).toEqual([25, 1, 1, 1, 1]);
    expect(wrapper.get('[data-test="options-used"]').text()).toBe('29 of the 29 spaces between the start and the finish are special.');
    expect(wrapper.findAll('[data-test="more"]').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    await inputs[1].setValue('7');
    await inputs[1].trigger('change');
    expect(counts(wrapper)[1]).toBe(1); // no room left
    await inputs[2].setValue('-3');
    await inputs[2].trigger('change');
    expect(counts(wrapper)[2]).toBe(0);
    expect(wrapper.findAll('[data-test="less"]')[2].attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="options-reset"]').trigger('click');
    expect(counts(wrapper)).toEqual([1, 1, 1, 1, 1]);
    wrapper.unmount();
  });

  it('saves the options and closes', async () => {
    const { wrapper, socket } = modal();
    await wrapper.get('[data-test="options-goal"]').setValue('100');
    await wrapper.findAll('[data-test="more"]')[4].trigger('click'); // a second instant win
    await wrapper.get('[data-test="options-save"]').trigger('click');
    expect(socket.last()).toMatchObject({
      event: 'game:configure',
      payload: { goal: 100, specials: { individual: 5, back: 4, forward: 4, dead: 1, win: 2 } },
    });
    socket.last().reply({ ok: true, data: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('closes without saving on Cancel or Escape', async () => {
    const { wrapper, socket } = modal();
    const before = socket.sent.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.get('[data-test="options-cancel"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    expect(socket.sent.length).toBe(before);
    wrapper.unmount();
  });

  it('speaks Portuguese too', () => {
    const s = setup('pt-BR');
    const wrapper = mount(GameOptionsModal, { props: { store: s.store, view: lobbyView('a') }, global: s.global });
    expect(wrapper.text()).toContain('Opções do jogo');
    expect(wrapper.get('[data-test="options-used"]').text()).toBe('9 das 59 casas entre o início e a chegada são especiais.');
  });
});

describe('points options', () => {
  const modal = (view = lobbyView('a'), locale: Locale = 'en') => {
    const s = setup(locale);
    const wrapper = mount(GameOptionsModal, { props: { store: s.store, view }, global: s.global });
    return { ...s, wrapper };
  };
  const values = (w: ReturnType<typeof mount>, test: string) =>
    w.findAll(`[data-test="${test}"]`).map((i) => Number((i.element as HTMLInputElement).value));

  it('shows the standard points on their own page of the options window', async () => {
    const { wrapper } = modal();
    expect(wrapper.get('[data-test="points-tab"]').isVisible()).toBe(false);
    await wrapper.get('[data-test="tab-points"]').trigger('click');
    expect(wrapper.get('[data-test="points-tab"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-test="board-tab"]').isVisible()).toBe(false);
    expect(wrapper.findAll('[data-test="points-row"]')).toHaveLength(20);
    expect(values(wrapper, 'points-guesser')).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(values(wrapper, 'points-holder')).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(values(wrapper, 'points-nobody')).toEqual([20]);
    expect(values(wrapper, 'points-individual')).toEqual([10, 8, 6, 4, 2]);
  });

  it('saves the points typed, kept between 0 and 300, together with the board options', async () => {
    const { wrapper, socket } = modal();
    await wrapper.get('[data-test="tab-points"]').trigger('click');
    const set = async (test: string, index: number, value: string) => {
      const input = wrapper.findAll(`[data-test="${test}"]`)[index];
      await input.setValue(value);
      await input.trigger('change');
    };
    await set('points-guesser', 0, '30');
    await set('points-holder', 0, '-4');
    await set('points-holder', 19, '5000');
    await set('points-nobody', 0, '12.7');
    await set('points-individual', 4, '3');
    expect(values(wrapper, 'points-holder')[0]).toBe(0);
    expect(values(wrapper, 'points-holder')[19]).toBe(300);
    await wrapper.get('[data-test="options-save"]').trigger('click');
    const sent = socket.last();
    expect(sent.event).toBe('game:configure');
    expect(sent.payload.goal).toBe(60);
    expect(sent.payload.scoring.guesser.slice(0, 2)).toEqual([30, 18]);
    expect(sent.payload.scoring.holder[0]).toBe(0);
    expect(sent.payload.scoring.holder[19]).toBe(300);
    expect(sent.payload.scoring.nobody).toBe(12);
    expect(sent.payload.scoring.individual).toEqual([10, 8, 6, 4, 3]);
  });

  it('can go back to the standard points, and changing the board size leaves the points alone', async () => {
    const view = lobbyView('a');
    view.settings.scoring = { ...defaultScoring(), nobody: 3 };
    const { wrapper } = modal(view);
    await wrapper.get('[data-test="options-goal"]').setValue('30');
    expect(values(wrapper, 'points-nobody')).toEqual([3]);
    await wrapper.get('[data-test="points-reset"]').trigger('click');
    expect(values(wrapper, 'points-nobody')).toEqual([20]);
  });

  it('tells the players in the room when the points are not the standard ones', () => {
    const view = lobbyView('b');
    view.settings.scoring = { ...defaultScoring(), nobody: 3 };
    const { store, global } = setup('pt-BR');
    const lobby = mount(LobbyScreen, { props: { store, view }, global });
    expect(lobby.get('[data-test="summary-points"]').text()).toBe('Pontos alterados pelo anfitrião');
  });

  it('uses the points set for individual questions in the explanations', () => {
    const view = individualView('c');
    view.settings.scoring = { ...defaultScoring(), individual: [9, 7, 5, 3, 1] };
    const { wrapper } = game(view);
    expect(wrapper.get('[data-test="individual-about"]').text()).toContain('Right after 1 tip: 9 spaces, 2: 7, 3: 5, 4: 3, 5: 1.');
    expect(wrapper.get('[data-test="legend"]').text()).toContain('right after 1 tip → 9 spaces, 2 → 7');
  });
});

describe('time limits', () => {
  it('are chosen on their own page of the options window: 15, 30, 60, 120 seconds or no limit', async () => {
    const s = setup();
    const wrapper = mount(GameOptionsModal, { props: { store: s.store, view: lobbyView('a') }, global: s.global });
    await wrapper.get('[data-test="tab-time"]').trigger('click');
    expect(wrapper.get('[data-test="time-tab"]').isVisible()).toBe(true);
    const tip = wrapper.get('[data-test="time-tip"]');
    expect(tip.findAll('option').map((o) => o.text())).toEqual(['15 s', '30 s', '60 s', '120 s', 'No limit']);
    expect((tip.element as HTMLSelectElement).value).toBe('0'); // no limit by default
    expect((wrapper.get('[data-test="time-guess"]').element as HTMLSelectElement).value).toBe('0');
    await tip.setValue('30');
    await wrapper.get('[data-test="time-guess"]').setValue('120');
    await wrapper.get('[data-test="options-save"]').trigger('click');
    expect(s.socket.last().payload.timers).toEqual({ tip: 30, guess: 120 });
    expect(s.socket.last().payload.goal).toBe(60);
  });

  it('are shown to everybody in the room', () => {
    const { store, global } = setup();
    const none = mount(LobbyScreen, { props: { store, view: lobbyView('b') }, global });
    expect(none.get('[data-test="summary-time"]').text()).toBe('No time limit');
    const view = lobbyView('b');
    view.settings.timers = { tip: 30, guess: 0 };
    const some = mount(LobbyScreen, { props: { store, view }, global });
    expect(some.get('[data-test="summary-time"]').text()).toBe('Time limit: tip 30 s · guess No limit');
  });

  it('show a countdown during the turn, only when there is a limit', () => {
    expect(game(makeView()).wrapper.find('[data-test="timer"]').exists()).toBe(false);
    const view = makeView();
    view.round!.timer = { limitMs: 30_000, leftMs: 12_400 };
    const { wrapper } = game(view);
    expect(wrapper.get('[data-test="timer"]').text()).toContain('13');
  });

  it('count down by themselves and start again from what the server says', async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      const wrapper = mount(TurnTimer, { props: { timer: { limitMs: 30_000, leftMs: 30_000 } }, global: s.global });
      expect(wrapper.text()).toContain('30');
      jest.advanceTimersByTime(10_000);
      await nextTick();
      expect(wrapper.text()).toContain('20');
      jest.advanceTimersByTime(60_000);
      await nextTick();
      expect(wrapper.text()).toContain('0'); // stops at zero
      await wrapper.setProps({ timer: { limitMs: 15_000, leftMs: 15_000 } });
      expect(wrapper.text()).toContain('15');
      wrapper.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('say when the clock played for somebody', () => {
    const view = makeView({ phase: 'guessing' });
    view.round!.timedOut = { playerId: 'b', action: 'tip' };
    expect(game(view).wrapper.get('[data-test="timed-out"]').text()).toContain('Time ran out: a random tip was picked for Bob.');
    const passed = makeView({ you: 'a' });
    passed.round!.timedOut = { playerId: 'c', action: 'pass' };
    expect(game(passed, 'pt-BR').wrapper.get('[data-test="timed-out"]').text()).toContain('O tempo de Cy acabou e a vez passou.');
    expect(game(makeView()).wrapper.find('[data-test="timed-out"]').exists()).toBe(false);
  });
});

describe('a board made by the host', () => {
  const open = async (view = lobbyView('a'), readonly = false) => {
    const s = setup();
    const wrapper = mount(GameOptionsModal, { props: { store: s.store, view, readonly }, global: s.global });
    return { ...s, wrapper };
  };
  const kinds = (w: ReturnType<typeof mount>) =>
    Object.fromEntries(
      w
        .findAll('[data-test="editor-space"]')
        .filter((b) => b.attributes('data-kind'))
        .map((b) => [Number(b.attributes('data-index')), b.attributes('data-kind')]),
    );

  it('is chosen instead of the random board, and shows a copy of the board', async () => {
    const { wrapper } = await open();
    expect(wrapper.find('[data-test="board-editor"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="options-special"]')).toHaveLength(5);
    await wrapper.get('[data-test="mode-custom"] input').setValue(true);
    expect(wrapper.findAll('[data-test="options-special"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test="editor-space"]')).toHaveLength(59); // spaces 1 to 59
    expect(wrapper.findAll('[data-test="editor-end"]')).toHaveLength(2); // start and finish can't be changed
  });

  it('changes a space to the next kind on each click', async () => {
    const { wrapper } = await open();
    await wrapper.get('[data-test="mode-custom"] input').setValue(true);
    const space = () => wrapper.get('[data-test="editor-space"][data-index="7"]');
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await space().trigger('click');
      seen.push(space().attributes('data-kind') ?? 'normal');
    }
    expect(seen).toEqual(['individual', 'back', 'forward', 'dead', 'win', 'normal']);
    expect(space().attributes('aria-label')).toBe('Space 7: normal');
  });

  it('saves the board made, with what it holds', async () => {
    const { wrapper, socket } = await open();
    await wrapper.get('[data-test="mode-custom"] input').setValue(true);
    await wrapper.get('[data-test="editor-space"][data-index="12"]').trigger('click'); // individual
    for (let i = 0; i < 5; i++) await wrapper.get('[data-test="editor-space"][data-index="3"]').trigger('click'); // win
    expect(wrapper.findAll('[data-test="custom-count"]').map((c) => c.text())).toEqual(['❓1', '−50', '+50', '💀0', '🏆1']);
    expect(wrapper.get('[data-test="custom-used"]').text()).toBe('2 of the 59 spaces between the start and the finish are special.');
    await wrapper.get('[data-test="options-save"]').trigger('click');
    expect(socket.last().payload).toMatchObject({
      boardMode: 'custom',
      customBoard: [
        { index: 3, kind: 'win' },
        { index: 12, kind: 'individual' },
      ],
    });
  });

  it('can start from a random board, be cleared, and keeps what fits when the size changes', async () => {
    const view = lobbyView('a');
    view.settings.boardMode = 'custom';
    view.settings.customBoard = [
      { index: 5, kind: 'dead' },
      { index: 40, kind: 'win' },
    ];
    const { wrapper } = await open(view);
    expect(kinds(wrapper)).toEqual({ 5: 'dead', 40: 'win' });
    await wrapper.get('[data-test="options-goal"]').setValue('30');
    expect(kinds(wrapper)).toEqual({ 5: 'dead' });
    expect(wrapper.findAll('[data-test="editor-space"]')).toHaveLength(29);
    await wrapper.get('[data-test="board-random-fill"]').trigger('click');
    expect(Object.keys(kinds(wrapper))).toHaveLength(5); // the default numbers for 30: one of each
    await wrapper.get('[data-test="board-clear"]').trigger('click');
    expect(kinds(wrapper)).toEqual({});
  });

  it('can be looked at, but not changed, by the other players', async () => {
    const view = lobbyView('b');
    view.settings.boardMode = 'custom';
    view.settings.customBoard = [{ index: 5, kind: 'dead' }];
    const { wrapper, socket } = await open(view, true);
    const before = socket.sent.length;
    await wrapper.get('[data-test="editor-space"][data-index="5"]').trigger('click');
    expect(kinds(wrapper)).toEqual({ 5: 'dead' });
    expect(wrapper.find('[data-test="board-clear"]').exists()).toBe(false);
    expect(socket.sent.length).toBe(before);
  });

  it('is announced in the room, with its numbers of special spaces', () => {
    const view = lobbyView('b');
    view.settings.boardMode = 'custom';
    view.settings.customBoard = [
      { index: 5, kind: 'dead' },
      { index: 6, kind: 'dead' },
    ];
    const { store, global } = setup();
    const lobby = mount(LobbyScreen, { props: { store, view }, global });
    expect(lobby.get('[data-test="summary-goal"]').text()).toBe('Board of 60 spaces, made by the host');
    expect(lobby.findAll('[data-test="summary-special"]').map((s) => s.text())).toEqual(['❓0', '−50', '+50', '💀2', '🏆0']);
  });
});

describe('skipping a card', () => {
  const holderView = (revealed: number[] = []) => {
    const v = makeView({ you: 'a', phase: 'choosing' });
    v.round!.revealed = revealed;
    v.round!.answer = 'Paris';
    v.round!.cardChosen = revealed.length > 0;
    return v;
  };

  it('is offered to the card holder before the first tip, and sends the request', async () => {
    const { wrapper, socket } = game(holderView());
    expect(wrapper.get('[data-test="skip-card"]').text()).toContain('Skip this card');
    await wrapper.get('[data-test="skip-card"]').trigger('click');
    expect(socket.last().event).toBe('game:skipCard');
  });

  it('comes with "Use this card", which lets the others pick tips', async () => {
    const { wrapper, socket } = game(holderView());
    expect(wrapper.get('[data-test="status"]').text()).toBe('Choose the card: use it, or skip it and draw another.');
    await wrapper.get('[data-test="choose-card"]').trigger('click');
    expect(socket.last().event).toBe('game:chooseCard');
  });

  it('makes the others wait, with no tips to pick, until the card is chosen', () => {
    const waiting = makeView({ phase: 'choosing' }); // Bob's turn, Ana holds the card
    waiting.round!.cardChosen = false;
    const { wrapper } = game(waiting);
    expect(wrapper.get('[data-test="status"]').text()).toBe('Waiting for Ana to choose the card…');
    expect(wrapper.findAll('[data-test="pick"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('worth');
    const chosen = makeView({ phase: 'choosing' });
    expect(game(chosen).wrapper.findAll('[data-test="pick"]')).toHaveLength(19);
  });

  it('is not offered once the card is chosen', () => {
    const v = holderView();
    v.round!.cardChosen = true;
    const { wrapper } = game(v);
    expect(wrapper.find('[data-test="skip-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="choose-card"]').exists()).toBe(false);
  });

  it('is not offered once a tip is shown, nor to the other players', () => {
    expect(game(holderView([3])).wrapper.find('[data-test="skip-card"]').exists()).toBe(false);
    const guesser = makeView({ phase: 'choosing' });
    guesser.round!.revealed = [];
    expect(game(guesser).wrapper.find('[data-test="skip-card"]').exists()).toBe(false);
  });

  it('is told to everybody', () => {
    const v = makeView({ you: 'c' });
    v.round!.skipped = 2;
    expect(game(v).wrapper.get('[data-test="skipped-note"]').text()).toContain('Ana skipped 2 cards.');
    const one = makeView({ you: 'c' });
    one.round!.skipped = 1;
    expect(game(one, 'pt-BR').wrapper.get('[data-test="skipped-note"]').text()).toContain('Ana pulou uma carta.');
    expect(game(makeView()).wrapper.find('[data-test="skipped-note"]').exists()).toBe(false);
  });
});

