import { Game, GameError } from '../src/game/Game';
import { defaultTimers, TIMER_CHOICES } from '../src/types';
import { noSpecials, testCards, zero, QuickGame } from './helpers';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) return e.code;
    throw e;
  }
  return null;
};

const noCounts = { individual: 0, back: 0, forward: 0, dead: 0, win: 0 };

/** Players a, b, c with a clock the test moves by hand; a holds the first card, b has the first turn. */
function started(timers: { tip: number; guess: number }, names = ['Ana', 'Bob', 'Cy'], layout = noSpecials) {
  const clock = { now: 1_000_000 };
  const game = new QuickGame('TEST', testCards, zero, { layout, now: () => clock.now });
  names.forEach((name, i) => game.addPlayer('abc'[i], name));
  game.configure('a', { goal: 60, specials: noCounts, timers });
  game.start('a');
  const wait = (seconds: number) => (clock.now += seconds * 1000);
  return { game, wait };
}

const view = (game: Game, id = 'a') => game.viewFor(id, 'en');

describe('time limit options', () => {
  it('are "no limit" unless the host changes them', () => {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    expect(defaultTimers()).toEqual({ tip: 0, guess: 0 });
    expect(view(game).settings.timers).toEqual({ tip: 0, guess: 0 });
    expect(TIMER_CHOICES).toEqual([15, 30, 60, 120, 0]);
  });

  it('accept only 15, 30, 60, 120 seconds or no limit', () => {
    const game = new QuickGame('TEST', testCards, zero);
    game.addPlayer('a', 'Ana');
    for (const tip of TIMER_CHOICES) {
      game.configure('a', { goal: 60, specials: noCounts, timers: { tip, guess: 120 } });
      expect(view(game).settings.timers).toEqual({ tip, guess: 120 });
    }
    const bad = (timers: unknown) => code(() => game.configure('a', { goal: 60, specials: noCounts, timers }));
    expect(bad({ tip: 10, guess: 30 })).toBe('invalidTimers');
    expect(bad({ tip: 30, guess: -1 })).toBe('invalidTimers');
    expect(bad({ tip: 30 })).toBe('invalidTimers');
    expect(bad({ tip: '30', guess: 30 })).toBe('invalidTimers');
    expect(bad(null)).toBe('invalidTimers');
    expect(view(game).settings.timers).toEqual({ tip: 0, guess: 120 }); // the last good ones
    game.configure('a', { goal: 30, specials: noCounts }); // saved without them: they stay
    expect(view(game).settings.timers).toEqual({ tip: 0, guess: 120 });
  });
});

describe('the clock', () => {
  it('starts with the turn, not when somebody first looks at it', () => {
    const { game, wait } = started({ tip: 30, guess: 0 });
    wait(30); // nobody has asked for the deadline or a view yet
    expect(game.expire()).toBe(true);
  });
});

describe('without a time limit', () => {
  it('no clock runs and nothing ever happens by itself', () => {
    const { game, wait } = started({ tip: 0, guess: 0 });
    expect(game.deadline).toBeNull();
    expect(view(game).round!.timer).toBeNull();
    wait(100_000);
    expect(game.expire()).toBe(false);
    expect(view(game).round).toMatchObject({ turnId: 'b', revealed: [] });
  });
});

describe('time to pick a tip', () => {
  it('shows everybody how much time is left', () => {
    const { game, wait } = started({ tip: 30, guess: 0 });
    expect(view(game, 'c').round!.timer).toEqual({ limitMs: 30_000, leftMs: 30_000 });
    wait(12);
    expect(view(game, 'c').round!.timer).toEqual({ limitMs: 30_000, leftMs: 18_000 });
  });

  it('does nothing before the time is up', () => {
    const { game, wait } = started({ tip: 30, guess: 0 });
    wait(29);
    expect(game.expire()).toBe(false);
    expect(view(game).round!.revealed).toEqual([]);
  });

  it('picks a tip at random when the time is up, and the player can then guess', () => {
    const { game, wait } = started({ tip: 30, guess: 0 });
    wait(30);
    expect(game.expire()).toBe(true);
    const round = view(game).round!;
    expect(round.revealed).toHaveLength(1);
    expect(round.turnId).toBe('b');
    expect(view(game).phase).toBe('guessing');
    expect(round.timedOut).toEqual({ playerId: 'b', action: 'tip' });
    expect(round.timer).toBeNull(); // no limit for guessing here
    expect(game.expire()).toBe(false);
    game.pass('b');
    expect(view(game).round!.timedOut).toBeNull();
  });

  it('picks among the tips still hidden', () => {
    const { game, wait } = started({ tip: 15, guess: 0 }, ['Ana', 'Bob']);
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      wait(15);
      expect(game.expire()).toBe(true);
      seen.add(view(game).round!.revealed[i]);
      if (i < 19) game.pass('b');
    }
    expect(seen.size).toBe(20);
  });

  it('gives every turn the full time', () => {
    const { game, wait } = started({ tip: 30, guess: 0 });
    wait(20);
    game.chooseTip('b', 0);
    game.pass('b'); // now c picks
    expect(view(game).round!.timer).toEqual({ limitMs: 30_000, leftMs: 30_000 });
    wait(29);
    expect(game.expire()).toBe(false);
    wait(1);
    expect(game.expire()).toBe(true);
    expect(view(game).round!.timedOut).toEqual({ playerId: 'c', action: 'tip' });
  });
});

describe('time to guess', () => {
  it('passes for a player who does not guess in time', () => {
    const { game, wait } = started({ tip: 0, guess: 15 });
    expect(game.deadline).toBeNull(); // no limit for picking
    game.chooseTip('b', 4);
    expect(view(game).round!.timer).toEqual({ limitMs: 15_000, leftMs: 15_000 });
    wait(14);
    expect(game.expire()).toBe(false);
    wait(1);
    expect(game.expire()).toBe(true);
    const v = view(game);
    expect(v.phase).toBe('choosing');
    expect(v.round!.turnId).toBe('c');
    expect(v.round!.guesses).toEqual([]);
    expect(v.round!.timedOut).toEqual({ playerId: 'b', action: 'pass' });
  });

  it('does not touch a guess made in time', () => {
    const { game, wait } = started({ tip: 0, guess: 15 });
    game.chooseTip('b', 4);
    wait(10);
    game.guess('b', 'wrong');
    wait(10);
    expect(game.expire()).toBe(false); // c is picking, with no limit
    expect(view(game).round!.guesses).toHaveLength(1);
  });

  it('ends the round for the card holder when the last tip goes by unanswered', () => {
    const { game, wait } = started({ tip: 15, guess: 15 }, ['Ana', 'Bob']);
    for (let i = 0; i < 40; i++) {
      wait(15);
      expect(game.expire()).toBe(true);
    }
    expect(view(game).phase).toBe('roundEnd');
    expect(view(game).result).toMatchObject({ reason: 'noTipsLeft', holderPoints: 20 });
    expect(game.deadline).toBeNull();
    expect(game.expire()).toBe(false);
  });
});

describe('the clock and players who are away', () => {
  it('stops while the only player who can play is away, and starts again in full when they return', () => {
    const { game, wait } = started({ tip: 30, guess: 30 }, ['Ana', 'Bob']);
    wait(20);
    game.setConnected('b', false);
    expect(game.deadline).toBeNull();
    wait(500);
    expect(game.expire()).toBe(false);
    game.setConnected('b', true);
    expect(view(game).round!.timer).toEqual({ limitMs: 30_000, leftMs: 30_000 });
  });

  it('runs in full for the next player when the one on turn goes away', () => {
    const { game, wait } = started({ tip: 30, guess: 30 });
    wait(25);
    game.setConnected('b', false);
    expect(view(game).round!.turnId).toBe('c');
    expect(view(game).round!.timer).toEqual({ limitMs: 30_000, leftMs: 30_000 });
  });

  it('does not run between rounds or in the lobby', () => {
    const { game, wait } = started({ tip: 15, guess: 15 }, ['Ana', 'Bob']);
    game.chooseTip('b', 0);
    game.guess('b', view(game, 'a').round!.answer!);
    expect(view(game).phase).toBe('roundEnd');
    expect(game.deadline).toBeNull();
    wait(100);
    expect(game.expire()).toBe(false);
    game.nextRound('a');
    expect(view(game).round!.timer).toEqual({ limitMs: 15_000, leftMs: 15_000 });
  });
});

describe('time limits in an individual question', () => {
  it('pick a random tip and pass for the player answering', () => {
    const layout = () => [{ index: 15, kind: 'individual' as const }];
    const { game, wait } = started({ tip: 15, guess: 15 }, ['Ana', 'Bob', 'Cy'], layout);
    // b gets the card right after 5 tips and lands on the individual question
    for (let i = 0; i < 5; i++) {
      const who = view(game).round!.turnId!;
      game.chooseTip(who, i);
      if (i < 4) game.pass(who);
    }
    game.guess('b', view(game, 'a').round!.answer!);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ kind: 'individual', turnId: 'b' });
    for (let i = 0; i < 10; i++) {
      wait(15);
      expect(game.expire()).toBe(true);
      if (view(game).phase === 'roundEnd') break;
      expect(view(game).round!.turnId).toBe('b');
    }
    expect(view(game).result).toMatchObject({ kind: 'individual', reason: 'noTipsLeft', tipsUsed: 5 });
  });
});
