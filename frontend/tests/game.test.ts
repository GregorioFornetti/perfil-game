import {
  acceptableGuessIds,
  canGuess,
  canPickTip,
  canStartNextRound,
  connectedCount,
  guessWorth,
  individualPointsParams,
  isIndividual,
  specialAt,
  isHolder,
  isHost,
  isMyTurn,
  me,
  playerById,
  ranking,
} from '../src/game';
import { individualView, makeView } from './helpers';

describe('questions about the game state', () => {
  it('knows who is who', () => {
    const v = makeView();
    expect(me(v)?.name).toBe('Bob');
    expect(playerById(v, 'a')?.name).toBe('Ana');
    expect(playerById(v, 'nobody')).toBeUndefined();
    expect(isHost(v)).toBe(false);
    expect(isHolder(v)).toBe(false);
    expect(isMyTurn(v)).toBe(true);
    expect(isHost(makeView({ you: 'a' }))).toBe(true);
    expect(isHolder(makeView({ you: 'a' }))).toBe(true);
    expect(connectedCount(v)).toBe(2);
  });

  it('lets the player on turn pick a hidden tip, only while choosing', () => {
    const v = makeView();
    expect(canPickTip(v, 0)).toBe(true);
    expect(canPickTip(v, 3)).toBe(false); // already shown
    expect(canPickTip(makeView({ you: 'c' }), 0)).toBe(false);
    expect(canPickTip(makeView({ phase: 'guessing' }), 0)).toBe(false);
    const waiting = makeView();
    waiting.round!.cardChosen = false;
    expect(canPickTip(waiting, 0)).toBe(false);
    expect(canGuess(v)).toBe(false);
    expect(canGuess(makeView({ phase: 'guessing' }))).toBe(true);
    expect(canGuess(makeView({ phase: 'guessing', you: 'a' }))).toBe(false);
  });

  it('works out what a right guess is worth (while picking: with the tip about to be picked)', () => {
    expect(guessWorth(makeView({ phase: 'guessing' }))).toBe(19); // 1 tip shown
    expect(guessWorth(makeView())).toBe(18); // picking the 2nd
    const v = makeView({ phase: 'guessing' });
    v.round!.revealed = [0, 1, 2, 3, 4];
    expect(guessWorth(v)).toBe(15);
    expect(guessWorth({ ...v, phase: 'choosing' })).toBe(14);
  });

  it('uses the points the host set', () => {
    const v = makeView({ phase: 'guessing' });
    v.settings.scoring = { ...v.settings.scoring, guesser: Array.from({ length: 20 }, (_, i) => 50 - i) };
    expect(guessWorth(v)).toBe(50);
    const ind = { ...individualView('b', [0, 1]), phase: 'guessing' as const };
    ind.settings.scoring = { ...ind.settings.scoring, individual: [9, 7, 5, 3, 1] };
    expect(guessWorth(ind)).toBe(7);
    expect(individualPointsParams(ind)).toEqual({ p1: 9, p2: 7, p3: 5, p4: 3, p5: 1 });
  });

  it('ranks players without reordering them in place', () => {
    const v = makeView();
    expect(ranking(v).map((p) => p.name)).toEqual(['Bob', 'Ana', 'Cy']);
    expect(v.players.map((p) => p.name)).toEqual(['Ana', 'Bob', 'Cy']); // not reordered in place
  });

  it('lets the host or the card holder start the next round', () => {
    const result = { kind: 'normal' as const, solverId: null, effects: [], reason: 'guessed' as const, answer: 'X', holderId: 'b', winnerId: 'c', tipsUsed: 1, guesserPoints: 19, holderPoints: 1 };
    expect(canStartNextRound(makeView({ phase: 'roundEnd', result, you: 'a' }))).toBe(true);
    expect(canStartNextRound(makeView({ phase: 'roundEnd', result, you: 'b' }))).toBe(true);
    expect(canStartNextRound(makeView({ phase: 'roundEnd', result, you: 'c' }))).toBe(false);
    expect(canStartNextRound(makeView({ you: 'a' }))).toBe(false);
  });

  it('offers wrong guesses to the card holder only', () => {
    expect(acceptableGuessIds(makeView())).toEqual([]);
    expect(acceptableGuessIds(makeView({ you: 'a' }))).toEqual([1]);
    const right = makeView({ you: 'a' });
    right.round!.guesses[0].correct = true;
    expect(acceptableGuessIds(right)).toEqual([]);
    const result = { kind: 'normal' as const, solverId: null, effects: [], reason: 'noTipsLeft' as const, answer: 'X', holderId: 'a', winnerId: null, tipsUsed: 20, guesserPoints: 0, holderPoints: 20 };
    expect(acceptableGuessIds(makeView({ you: 'a', phase: 'roundEnd', result }))).toEqual([1]);
    expect(acceptableGuessIds(makeView({ you: 'a', phase: 'roundEnd', result: { ...result, reason: 'holderLeft' } }))).toEqual([]);
  });
});

describe('special spaces and individual questions', () => {
  it('knows which spaces are special', () => {
    const v = makeView();
    expect(specialAt(v, 7)).toBe('individual');
    expect(specialAt(v, 41)).toBe('win');
    expect(specialAt(v, 8)).toBeUndefined();
  });

  it('allows at most 5 tips in an individual question, only to the player answering', () => {
    const v = individualView('b', [0, 1, 2, 3]);
    expect(isIndividual(v)).toBe(true);
    expect(isIndividual(makeView())).toBe(false);
    expect(canPickTip(v, 10)).toBe(true);
    expect(canPickTip(individualView('c', [0, 1, 2, 3]), 10)).toBe(false);
    expect(canPickTip(individualView('b', [0, 1, 2, 3, 4]), 10)).toBe(false);
  });

  it('values a right answer to an individual question at 10, 8, 6, 4, 2', () => {
    const worth = (n: number) => guessWorth({ ...individualView('b', Array.from({ length: n }, (_, i) => i)), phase: 'guessing' });
    expect([1, 2, 3, 4, 5].map(worth)).toEqual([10, 8, 6, 4, 2]);
    expect(guessWorth(individualView('b', []))).toBe(10);
  });

  it('lets the player who answered an individual question go on to the next round', () => {
    const result = { kind: 'individual' as const, solverId: 'c', effects: [], reason: 'noTipsLeft' as const, answer: 'X', holderId: 'a', winnerId: null, tipsUsed: 5, guesserPoints: 0, holderPoints: 0 };
    expect(canStartNextRound(makeView({ phase: 'roundEnd', result, you: 'c' }))).toBe(true);
    expect(canStartNextRound(makeView({ phase: 'roundEnd', result, you: 'b' }))).toBe(false);
  });
});

