import { randomLayout, specialCounts } from '../src/game/board';
import { Game, GameError } from '../src/game/Game';
import { defaultScoring, individualPoints, Scoring, SpecialKind, SpecialSpace } from '../src/types';
import { testCards, zero, QuickGame } from './helpers';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) return e.code;
    throw e;
  }
  return null;
};

/**
 * Players a (Ana), b (Bob), c (Cy); a holds the first card, b has the first turn.
 * The board has exactly the special spaces given.
 */
function started(specials: Record<number, SpecialKind>, goal = 60, names = ['Ana', 'Bob', 'Cy']) {
  const layout = (): SpecialSpace[] => Object.entries(specials).map(([index, kind]) => ({ index: Number(index), kind }));
  const game = new QuickGame('TEST', testCards, zero, { layout });
  names.forEach((name, i) => game.addPlayer('abc'[i], name));
  game.start('a', goal);
  return game;
}

const view = (game: Game, id = 'a') => game.viewFor(id, 'en');
const pos = (game: Game) => Object.fromEntries(view(game).players.map((p) => [p.id, p.position]));
const answer = (game: Game) => view(game, view(game).round!.holderId).round!.answer!;
const turn = (game: Game) => view(game).round!.turnId!;

/** Reveals tips (everybody passing) until `count` are out and it is somebody's turn to guess. */
function revealTips(game: Game, count: number) {
  for (let i = view(game).round!.revealed.length; i < count; i++) {
    if (view(game).phase === 'guessing') game.pass(turn(game));
    game.chooseTip(turn(game), i);
  }
}

/**
 * Whoever is on turn gets the card right once `tips` tips are out. Returns who it was.
 * (The turn goes b, c, b, c...: an odd number of tips means b, an even one c.)
 */
function rightAfter(game: Game, tips: number): string {
  revealTips(game, tips);
  const who = turn(game);
  expect(game.guess(who, answer(game))).toBe(true);
  return who;
}

describe('layout of the special spaces', () => {
  it('has one individual question per 15 normal spaces, one back and one forward per 20, one dead space and one instant win', () => {
    expect(specialCounts(60)).toEqual({ individual: 3, back: 2, forward: 2, dead: 1, win: 1 });
    expect(specialCounts(30)).toEqual({ individual: 1, back: 1, forward: 1, dead: 1, win: 1 });
    expect(specialCounts(20)).toEqual({ individual: 1, back: 0, forward: 0, dead: 1, win: 1 });
    expect(specialCounts(100)).toEqual({ individual: 5, back: 4, forward: 4, dead: 1, win: 1 });
    expect(specialCounts(150)).toEqual({ individual: 8, back: 6, forward: 6, dead: 1, win: 1 });
    // every special space has its 15 (or 20) normal spaces, and there is no room for one more
    for (let goal = 20; goal <= 300; goal++) {
      const c = specialCounts(goal);
      const normal = goal - 1 - Object.values(c).reduce((a, b) => a + b, 0);
      expect(c.back).toBe(c.forward);
      expect(c.individual * 15).toBeLessThanOrEqual(normal);
      expect(c.back * 20).toBeLessThanOrEqual(normal);
      // one more individual question would leave too few normal spaces for what is there
      expect((c.individual + 1) * 15 <= normal - 1 && c.back * 20 <= normal - 1).toBe(false);
      // within one of the simple rule, at any size
      expect(Math.abs(c.individual - Math.floor(normal / 15))).toBeLessThanOrEqual(1);
      expect(Math.abs(c.back - Math.floor(normal / 20))).toBeLessThanOrEqual(1);
    }
  });

  it('puts them on different spaces between the start and the finish, at random', () => {
    for (const goal of [20, 30, 60, 100, 150, 300]) {
      const layout = randomLayout(goal, Math.random);
      const counts = specialCounts(goal);
      expect(layout).toHaveLength(Object.values(counts).reduce((a, b) => a + b, 0));
      expect(new Set(layout.map((s) => s.index)).size).toBe(layout.length);
      for (const s of layout) {
        expect(s.index).toBeGreaterThanOrEqual(1);
        expect(s.index).toBeLessThanOrEqual(goal - 1);
      }
      for (const kind of Object.keys(counts) as SpecialKind[]) {
        expect(layout.filter((s) => s.kind === kind)).toHaveLength(counts[kind]);
      }
    }
    const boards = new Set(Array.from({ length: 5 }, () => JSON.stringify(randomLayout(60, Math.random))));
    expect(boards.size).toBeGreaterThan(1);
  });

  it('is drawn when a game starts and shown to everybody', () => {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    expect(view(game).specials).toEqual([]);
    game.start('a', 60);
    expect(view(game, 'b').specials).toHaveLength(9);
    expect(view(game, 'b').specials).toEqual(view(game, 'a').specials);
  });
});

describe('game options', () => {
  function lobby() {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    return game;
  }
  const counts = (individual: number, back: number, forward: number, dead: number, win: number) => ({ individual, back, forward, dead, win });

  it('start with a board of 60 and the default special spaces, shown to everybody', () => {
    expect(view(lobby(), 'b').settings).toMatchObject({ goal: 60, specials: counts(3, 2, 2, 1, 1) });
  });

  it('let the host choose the board size and how many special spaces of each kind', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials: counts(0, 3, 0, 2, 0) });
    expect(view(game, 'b').settings).toMatchObject({ goal: 30, specials: counts(0, 3, 0, 2, 0) });
    game.start('a');
    expect(view(game).goal).toBe(30);
    const kinds = view(game).specials.map((s) => s.kind).sort();
    expect(kinds).toEqual(['back', 'back', 'back', 'dead', 'dead']);
    expect(view(game).specials.every((s) => s.index >= 1 && s.index <= 29)).toBe(true);
  });

  it('allow a board with no special spaces, and one where every space is special', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials: counts(0, 0, 0, 0, 0) });
    game.start('a');
    expect(view(game).specials).toEqual([]);
    const full = lobby();
    full.configure('a', { goal: 20, specials: counts(10, 3, 3, 2, 1) }); // 19 = every space but start and finish
    full.start('a');
    expect(view(full).specials.map((s) => s.index)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it('refuse more special spaces than the board has room for', () => {
    const game = lobby();
    expect(code(() => game.configure('a', { goal: 20, specials: counts(10, 3, 3, 2, 2) }))).toBe('tooManySpecials');
    expect(code(() => game.configure('a', { goal: 30, specials: counts(29, 0, 0, 0, 1) }))).toBe('tooManySpecials');
    expect(view(game).settings.goal).toBe(60); // unchanged
  });

  it('refuse anything that is not a sensible option', () => {
    const game = lobby();
    expect(code(() => game.configure('b', { goal: 30, specials: counts(1, 1, 1, 1, 1) }))).toBe('onlyHost');
    expect(code(() => game.configure('a', { goal: 10, specials: counts(1, 1, 1, 1, 1) }))).toBe('invalidGoal');
    expect(code(() => game.configure('a', { goal: 30 }))).toBe('invalidSpecials');
    expect(code(() => game.configure('a', { goal: 30, specials: { ...counts(1, 1, 1, 1, 1), win: -1 } }))).toBe('invalidSpecials');
    expect(code(() => game.configure('a', { goal: 30, specials: { ...counts(1, 1, 1, 1, 1), dead: 1.5 } }))).toBe('invalidSpecials');
    expect(code(() => game.configure('a', { goal: 30, specials: { individual: 1 } }))).toBe('invalidSpecials');
    expect(code(() => game.configure('a', null))).toBe('invalidGoal');
    game.start('a');
    expect(code(() => game.configure('a', { goal: 30, specials: counts(1, 1, 1, 1, 1) }))).toBe('gameAlreadyStarted');
  });

  it('are kept for the next game, and a different size given when starting brings back the defaults', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials: counts(0, 0, 0, 0, 3) });
    game.start('a', 30); // same size: the chosen counts stay
    expect(view(game).specials).toHaveLength(3);
    revealTips(game, 20);
    game.pass('b'); // a +20
    game.nextRound('a');
    revealTips(game, 20);
    game.pass('a'); // b +20... someone reaches 30 eventually
    while (view(game).phase !== 'finished') {
      game.nextRound('a');
      revealTips(game, 20);
      game.pass(turn(game));
    }
    game.playAgain('a');
    expect(view(game).settings).toMatchObject({ goal: 30, specials: counts(0, 0, 0, 0, 3) });
    game.start('a', 100);
    expect(view(game).settings).toMatchObject({ goal: 100, specials: counts(5, 4, 4, 1, 1) });
  });
});

describe('a board made by the host', () => {
  function lobby() {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    return game;
  }
  const specials = { individual: 3, back: 2, forward: 2, dead: 1, win: 1 };
  const board: SpecialSpace[] = [
    { index: 29, kind: 'win' },
    { index: 3, kind: 'dead' },
    { index: 10, kind: 'individual' },
    { index: 11, kind: 'individual' },
  ];

  it('is off by default: the board is random', () => {
    expect(view(lobby()).settings).toMatchObject({ boardMode: 'random', customBoard: [] });
  });

  it('is used exactly as made, instead of a random one', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials, boardMode: 'custom', customBoard: board });
    expect(view(game, 'b').settings).toMatchObject({
      boardMode: 'custom',
      customBoard: [
        { index: 3, kind: 'dead' },
        { index: 10, kind: 'individual' },
        { index: 11, kind: 'individual' },
        { index: 29, kind: 'win' },
      ],
    });
    game.start('a');
    expect(view(game).specials).toEqual(view(game).settings.customBoard);
  });

  it('may have no special spaces at all, or every space special', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials, boardMode: 'custom', customBoard: [] });
    game.start('a');
    expect(view(game).specials).toEqual([]);
    const full = lobby();
    const all = Array.from({ length: 29 }, (_, i) => ({ index: i + 1, kind: 'back' as const }));
    full.configure('a', { goal: 30, specials, boardMode: 'custom', customBoard: all });
    full.start('a');
    expect(view(full).specials).toHaveLength(29);
  });

  it('is kept while the random board is chosen again, and comes back when switched to', () => {
    const game = lobby();
    game.configure('a', { goal: 30, specials, boardMode: 'custom', customBoard: board });
    game.configure('a', { goal: 30, specials, boardMode: 'random' });
    game.start('a');
    expect(view(game).specials).not.toEqual(view(game).settings.customBoard);
    expect(view(game).settings.customBoard).toHaveLength(4);
  });

  it('keeps the special spaces that still fit when the board size changes', () => {
    const game = lobby();
    game.configure('a', { goal: 60, specials, boardMode: 'custom', customBoard: [...board, { index: 45, kind: 'back' }] });
    game.configure('a', { goal: 30, specials });
    expect(view(game).settings.customBoard.map((s) => s.index)).toEqual([3, 10, 11, 29]);
    game.configure('a', { goal: 20, specials });
    expect(view(game).settings.customBoard.map((s) => s.index)).toEqual([3, 10, 11]);
  });

  it('refuses special spaces on the start or the finish, twice on one space, or of an unknown kind', () => {
    const game = lobby();
    const bad = (customBoard: unknown, boardMode: unknown = 'custom') =>
      code(() => game.configure('a', { goal: 30, specials, boardMode, customBoard }));
    expect(bad([{ index: 0, kind: 'win' }])).toBe('invalidBoard');
    expect(bad([{ index: 30, kind: 'win' }])).toBe('invalidBoard');
    expect(bad([{ index: 4.5, kind: 'win' }])).toBe('invalidBoard');
    expect(bad([{ index: 4, kind: 'win' }, { index: 4, kind: 'dead' }])).toBe('invalidBoard');
    expect(bad([{ index: 4, kind: 'teleport' }])).toBe('invalidBoard');
    expect(bad([null])).toBe('invalidBoard');
    expect(bad('everything')).toBe('invalidBoard');
    expect(bad([], 'hexagonal')).toBe('invalidBoard');
    expect(view(game).settings).toMatchObject({ goal: 60, boardMode: 'random', customBoard: [] });
  });

  it('works with the special spaces as usual', () => {
    const game = new QuickGame('TEST', testCards, zero);
    ['Ana', 'Bob', 'Cy'].forEach((n, i) => game.addPlayer('abc'[i], n));
    game.configure('a', { goal: 60, specials, boardMode: 'custom', customBoard: [{ index: 15, kind: 'forward' }] });
    game.start('a');
    rightAfter(game, 5); // b +15
    expect(pos(game).b).toBe(20);
  });
});

describe('points set by the host', () => {
  /** Like started(), with the given points and no special spaces unless asked. */
  function withScoring(scoring: Scoring, specials: Record<number, SpecialKind> = {}, goal = 60) {
    const layout = (): SpecialSpace[] => Object.entries(specials).map(([index, kind]) => ({ index: Number(index), kind }));
    const game = new QuickGame('TEST', testCards, zero, { layout });
    ['Ana', 'Bob', 'Cy'].forEach((name, i) => game.addPlayer('abc'[i], name));
    game.configure('a', { goal, specials: { individual: 0, back: 0, forward: 0, dead: 0, win: 0 }, scoring });
    game.start('a');
    return game;
  }
  const custom = (): Scoring => ({
    guesser: Array.from({ length: 20 }, (_, i) => 100 + i), // 1 tip: 100, 2 tips: 101...
    holder: Array.from({ length: 20 }, (_, i) => 200 + i),
    nobody: 7,
    individual: [50, 40, 30, 20, 0],
  });

  it('are the standard ones unless changed: guesser 20 - n, card holder n, nobody 20, individual 10/8/6/4/2', () => {
    const s = defaultScoring();
    expect(s.guesser).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(s.holder).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(s.nobody).toBe(20);
    expect(s.individual).toEqual([10, 8, 6, 4, 2]);
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    expect(view(game).settings.scoring).toEqual(s);
  });

  it('decide how far the guesser and the card holder move for each number of tips', () => {
    const game = withScoring(custom(), {}, 300);
    rightAfter(game, 3); // b guessed with 3 tips
    expect(pos(game)).toEqual({ a: 202, b: 102, c: 0 });
    expect(view(game).result).toMatchObject({ guesserPoints: 102, holderPoints: 202 });
  });

  it('decide how far the card holder moves when nobody gets it', () => {
    const game = withScoring(custom());
    revealTips(game, 20);
    game.pass(turn(game));
    expect(pos(game)).toEqual({ a: 7, b: 0, c: 0 });
  });

  it('decide how far a right answer to an individual question moves', () => {
    const scoring = { ...defaultScoring(), individual: [50, 40, 30, 20, 0] };
    const layout = () => [{ index: 15, kind: 'individual' as const }];
    const game = new QuickGame('TEST', testCards, zero, { layout });
    ['Ana', 'Bob', 'Cy'].forEach((name, i) => game.addPlayer('abc'[i], name));
    game.configure('a', { goal: 100, specials: { individual: 1, back: 0, forward: 0, dead: 0, win: 0 }, scoring });
    game.start('a');
    rightAfter(game, 5); // b 15, on the individual question
    game.nextRound('a');
    revealTips(game, 2);
    game.guess('b', answer(game));
    expect(pos(game).b).toBe(15 + 40);
    expect(view(game).result).toMatchObject({ kind: 'individual', guesserPoints: 40, holderPoints: 0 });
  });

  it('may be 0, and then nobody moves (and no special space acts)', () => {
    const zeroes: Scoring = { guesser: Array(20).fill(0), holder: Array(20).fill(0), nobody: 0, individual: [0, 0, 0, 0, 0] };
    const game = withScoring(zeroes, { 0: 'dead' });
    rightAfter(game, 1);
    expect(pos(game)).toEqual({ a: 0, b: 0, c: 0 });
    expect(view(game).result!.effects).toEqual([]);
  });

  it('refuse lists of the wrong length, negative or broken numbers, and too much', () => {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    const specials = { individual: 0, back: 0, forward: 0, dead: 0, win: 0 };
    const bad = (scoring: unknown) => code(() => game.configure('a', { goal: 30, specials, scoring }));
    expect(bad({ ...defaultScoring(), guesser: [1, 2, 3] })).toBe('invalidScoring');
    expect(bad({ ...defaultScoring(), holder: [...defaultScoring().holder.slice(1), -1] })).toBe('invalidScoring');
    expect(bad({ ...defaultScoring(), nobody: 2.5 })).toBe('invalidScoring');
    expect(bad({ ...defaultScoring(), nobody: 301 })).toBe('invalidScoring');
    expect(bad({ ...defaultScoring(), individual: [1, 2, 3, 4, '5'] })).toBe('invalidScoring');
    expect(bad(null)).toBe('invalidScoring');
    expect(view(game).settings.goal).toBe(60); // nothing changed
  });

  it('stay as they are when the options are saved without them, and are kept for the next game', () => {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    const specials = { individual: 0, back: 0, forward: 0, dead: 0, win: 0 };
    game.configure('a', { goal: 30, specials, scoring: custom() });
    game.configure('a', { goal: 60, specials });
    expect(view(game).settings.scoring).toEqual(custom());
  });
});

describe('special spaces after a normal round', () => {
  it('forward: the guesser landing there moves 5 more, and does not trigger the next space', () => {
    const game = started({ 15: 'forward', 20: 'back' });
    expect(rightAfter(game, 5)).toBe('b'); // b +15, a +5
    expect(pos(game)).toEqual({ a: 5, b: 20, c: 0 });
    expect(view(game).result!.effects).toEqual([{ playerId: 'b', kind: 'forward', from: 15, to: 20 }]);
  });

  it('back: the card holder landing there moves 5 back, never behind the start', () => {
    const game = started({ 3: 'back' });
    rightAfter(game, 3); // b +17, a +3
    expect(pos(game)).toEqual({ a: 0, b: 17, c: 0 });
    expect(view(game).result!.effects).toEqual([{ playerId: 'a', kind: 'back', from: 3, to: 0 }]);
  });

  it('dead space: back to the start', () => {
    const game = started({ 17: 'dead' });
    rightAfter(game, 3);
    expect(pos(game)).toEqual({ a: 3, b: 0, c: 0 });
    expect(view(game).result!.effects).toEqual([{ playerId: 'b', kind: 'dead', from: 17, to: 0 }]);
  });

  it('instant win: straight to the finish, and the game is won', () => {
    const game = started({ 17: 'win', 3: 'individual' });
    rightAfter(game, 3); // b lands on the instant win, a on an individual question
    expect(pos(game)).toEqual({ a: 3, b: 60, c: 0 });
    expect(view(game).phase).toBe('finished');
    expect(view(game).winnerId).toBe('b');
    expect(view(game).pendingIndividual).toEqual([]);
  });

  it('holding the card counts too, also when nobody gets it (20 spaces)', () => {
    const game = started({ 20: 'forward' });
    revealTips(game, 20);
    game.pass(turn(game));
    expect(pos(game)).toEqual({ a: 25, b: 0, c: 0 });
  });

  it('does nothing to a player who does not move (a right guess on the 20th tip is worth 0)', () => {
    const game = started({ 19: 'dead', 20: 'back' });
    rightAfter(game, 1); // b 19 -> dead -> 0... so use the holder instead
    expect(pos(game).b).toBe(0);
    game.nextRound('a'); // b holds, c guesses first
    revealTips(game, 20);
    const guesser = turn(game);
    game.guess(guesser, answer(game)); // guesser +0, holder b +20 -> back 5
    expect(view(game).result!.effects).toEqual([{ playerId: 'b', kind: 'back', from: 20, to: 15 }]);
  });

  it('applies to both players when both land on special spaces, the guesser first', () => {
    const game = started({ 15: 'forward', 5: 'back' });
    rightAfter(game, 5);
    expect(view(game).result!.effects).toEqual([
      { playerId: 'b', kind: 'forward', from: 15, to: 20 },
      { playerId: 'a', kind: 'back', from: 5, to: 0 },
    ]);
  });
});

describe('individual question', () => {
  it('scores 10, 8, 6, 4, 2 spaces for 1 to 5 tips', () => {
    expect([1, 2, 3, 4, 5].map(individualPoints)).toEqual([10, 8, 6, 4, 2]);
    expect(individualPoints(0)).toBe(0);
    expect(individualPoints(6)).toBe(0);
  });

  it('is played after the round by the player who landed there, alone, with a card held by somebody else', () => {
    const game = started({ 15: 'individual', 23: 'back' });
    expect(rightAfter(game, 5)).toBe('b'); // b 15 (individual), a 5
    expect(view(game).result!.effects).toEqual([{ playerId: 'b', kind: 'individual', from: 15, to: 15 }]);
    expect(view(game).pendingIndividual).toEqual(['b']);
    expect(view(game).phase).toBe('roundEnd');

    game.nextRound('a');
    const v = view(game, 'c');
    expect(v.round).toMatchObject({ kind: 'individual', number: 1, maxTips: 5, turnId: 'b', revealed: [], guesses: [] });
    const holder = v.round!.holderId;
    expect(holder).not.toBe('b');
    expect(view(game).pendingIndividual).toEqual([]);
    // only the holder sees the answer
    expect(view(game, holder).round!.answer).not.toBeNull();
    expect(view(game, 'b').round!.answer).toBeNull();

    // nobody else can play it
    const other = holder === 'a' ? 'c' : 'a';
    expect(code(() => game.chooseTip(other, 0))).toBe('notYourTurn');
    game.chooseTip('b', 0);
    expect(game.guess('b', 'wrong')).toBe(false);
    expect(view(game).round!.turnId).toBe('b'); // the turn stays with b
    game.chooseTip('b', 1);
    expect(game.guess('b', answer(game))).toBe(true);

    // 2 tips: 8 spaces; the holder does not move; no special space acts (23 is "back")
    expect(pos(game)).toMatchObject({ a: 5, b: 23, c: 0 });
    expect(view(game).result).toMatchObject({
      kind: 'individual',
      reason: 'guessed',
      winnerId: 'b',
      solverId: 'b',
      holderId: holder,
      tipsUsed: 2,
      guesserPoints: 8,
      holderPoints: 0,
      effects: [],
    });

    // then the normal rounds go on: the card goes to the player after the last card owner (a)
    game.nextRound('b'); // the player who answered may go on too
    expect(view(game).round).toMatchObject({ kind: 'normal', number: 2, holderId: 'b', turnId: 'c' });
  });

  it('gives at most 5 tips; a miss moves nobody', () => {
    const game = started({ 15: 'individual' });
    rightAfter(game, 5);
    game.nextRound('a');
    for (let i = 0; i < 5; i++) {
      game.chooseTip('b', i);
      game.pass('b');
    }
    expect(view(game).phase).toBe('roundEnd');
    expect(view(game).result).toMatchObject({ kind: 'individual', reason: 'noTipsLeft', winnerId: null, solverId: 'b', guesserPoints: 0, holderPoints: 0 });
    expect(pos(game)).toEqual({ a: 5, b: 15, c: 0 });
    expect(code(() => game.chooseTip('b', 5))).toBe('noRound');
  });

  it('lets the holder count a refused answer as right, with the tips there were then', () => {
    const game = started({ 15: 'individual' });
    rightAfter(game, 5);
    game.nextRound('a');
    const holder = view(game).round!.holderId;
    game.chooseTip('b', 0);
    game.pass('b');
    game.chooseTip('b', 1);
    game.guess('b', 'almost right'); // guess id 2, made with 2 tips out
    for (let i = 2; i < 5; i++) {
      game.chooseTip('b', i);
      game.pass('b');
    }
    expect(view(game).result!.reason).toBe('noTipsLeft');
    const guessId = view(game).round!.guesses.find((g) => g.text === 'almost right')!.id;
    expect(code(() => game.acceptGuess('b', guessId))).toBe('onlyHolder');
    game.acceptGuess(holder, guessId);
    expect(view(game).result).toMatchObject({ kind: 'individual', reason: 'guessed', tipsUsed: 2, guesserPoints: 8 });
    expect(pos(game).b).toBe(23);
  });

  it('queues two questions when the guesser and the card holder both land on one', () => {
    const game = started({ 15: 'individual', 5: 'individual' });
    rightAfter(game, 5);
    expect(view(game).pendingIndividual).toEqual(['b', 'a']);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'individual', turnId: 'b' });
    revealTips(game, 5);
    game.pass('b');
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'individual', turnId: 'a' });
    expect(view(game).round!.holderId).not.toBe('a');
    revealTips(game, 1);
    game.guess('a', answer(game));
    expect(pos(game).a).toBe(15);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'normal', number: 2, holderId: 'b' });
  });

  it('can win the game', () => {
    const game = started({ 15: 'individual' }, 20);
    rightAfter(game, 5); // b 15, a 5
    game.nextRound('a');
    revealTips(game, 1);
    game.guess('b', answer(game)); // +10 -> capped at 20
    expect(view(game).phase).toBe('finished');
    expect(view(game).winnerId).toBe('b');
  });

  it('finds another card holder if the one drawn leaves, and is cancelled if the player answering leaves', () => {
    const game = started({ 15: 'individual' });
    rightAfter(game, 5);
    game.nextRound('a');
    const holder = view(game).round!.holderId;
    game.setConnected(holder, false);
    const newHolder = view(game, 'b').round!.holderId;
    expect(newHolder).not.toBe(holder);
    expect(newHolder).not.toBe('b');
    game.setConnected('b', false); // just away: the question waits
    expect(view(game, newHolder).phase).toBe('choosing');
    expect(view(game, newHolder).round!.turnId).toBe('b');
    game.setConnected('b', true);
    game.removePlayer('b');
    expect(view(game, newHolder).result).toMatchObject({ kind: 'individual', reason: 'solverLeft', guesserPoints: 0 });
  });
});

describe('individual question with players away', () => {
  it('is skipped when its player is away as it is due', () => {
    const game = started({ 15: 'individual' });
    rightAfter(game, 5);
    game.setConnected('b', false);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'normal', number: 2 });
    expect(view(game).pendingIndividual).toEqual([]);
  });

  it('can be cancelled by the host or the card holder while its player is away', () => {
    const game = started({ 15: 'individual' }, 60, ['Ana', 'Bob', 'Cy']);
    rightAfter(game, 5);
    game.nextRound('a');
    const holder = view(game).round!.holderId;
    const other = holder === 'a' ? 'c' : 'a';
    expect(code(() => game.skipIndividual(holder))).toBe('solverIsHere');
    game.setConnected('b', false);
    if (other !== 'a') expect(code(() => game.skipIndividual(other))).toBe('onlyHostOrHolder');
    game.skipIndividual(holder);
    expect(view(game).result).toMatchObject({ kind: 'individual', reason: 'solverLeft', solverId: 'b', guesserPoints: 0 });
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'normal', number: 2 });
    expect(code(() => game.skipIndividual('a'))).toBe('noIndividual');
  });

  it('gets a card holder again when one comes back after nobody was left to hold it', () => {
    const game = started({ 15: 'individual' });
    rightAfter(game, 5);
    game.setConnected('c', false);
    game.nextRound('a'); // only a can hold it
    expect(view(game).round!.holderId).toBe('a');
    game.removePlayer('a');
    expect(view(game, 'b').round!.holderId).toBe('a'); // nobody to take it for now
    game.setConnected('c', true);
    expect(view(game, 'b').round!.holderId).toBe('c');
    expect(view(game, 'c').round!.answer).not.toBeNull();
  });
});

describe('the card going round the table', () => {
  it('goes to the next seat even when the last card owner has left the game', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: () => [] });
    ['Ana', 'Bob', 'Cy', 'Di'].forEach((n, i) => game.addPlayer('abcd'[i], n));
    game.start('a');
    const holders = [view(game).round!.holderId];
    for (let r = 0; r < 2; r++) {
      revealTips(game, 20);
      game.pass(turn(game));
      game.nextRound('a');
      holders.push(view(game).round!.holderId);
    }
    expect(holders).toEqual(['a', 'b', 'c']);
    game.removePlayer('c'); // the card owner leaves: round cancelled
    game.nextRound('a');
    expect(view(game).round!.holderId).toBe('d');
  });
});

describe('counting a refused guess after nobody got it', () => {
  it('undoes the special space the card holder had landed on', () => {
    const game = started({ 20: 'individual', 19: 'forward' });
    revealTips(game, 1);
    game.guess('b', 'close'); // refused; b would have had it with 1 tip
    revealTips(game, 20);
    game.pass(turn(game));
    expect(pos(game).a).toBe(20);
    expect(view(game).pendingIndividual).toEqual(['a']);
    game.acceptGuess('a', 1);
    // b +19 lands on "forward" -> 24; a +1
    expect(pos(game)).toEqual({ a: 1, b: 24, c: 0 });
    expect(view(game).pendingIndividual).toEqual([]);
    expect(view(game).result!.effects).toEqual([{ playerId: 'b', kind: 'forward', from: 19, to: 24 }]);
  });
});
