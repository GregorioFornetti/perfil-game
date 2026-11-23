import { Game, GameError } from '../src/game/Game';
import { Card } from '../src/types';
import { makeCard, noSpecials, zero } from './helpers';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) return e.code;
    throw e;
  }
  return null;
};

const cards: Card[] = [1, 2, 3, 4, 5].map((n) => makeCard(n));
const ids = cards.map((c) => c.id); // thing-test-1 ... thing-test-5

function lobby(names = ['Ana', 'Bob', 'Cy']) {
  const game = new Game('TEST', cards, zero, { layout: noSpecials });
  names.forEach((name, i) => game.addPlayer('abc'[i], name));
  return game;
}
const view = (game: Game, id = 'a') => game.viewFor(id, 'en');
/** The id of the card in play (the holder sees it). */
const current = (game: Game) => view(game, view(game).round!.holderId).round!.cardId!;
/** Plays the round to its end: everyone passes through all 20 tips. */
function finishRound(game: Game) {
  const round = view(game).round!;
  if (!round.cardChosen) game.chooseCard(round.holderId);
  for (let i = view(game).round!.revealed.length; i < 20; i++) {
    const who = view(game).round!.turnId!;
    game.chooseTip(who, i);
    game.pass(who);
  }
}

describe('skipping a card', () => {
  it('lets the card holder put the card aside and draw another before the first tip', () => {
    const game = lobby();
    game.start('a');
    const first = current(game);
    const firstAnswer = view(game, 'a').round!.answer;
    game.skipCard('a');
    expect(current(game)).not.toBe(first);
    expect(view(game, 'a').round!.answer).not.toBe(firstAnswer);
    expect(view(game, 'b').round).toMatchObject({ skipped: 1, turnId: 'b', revealed: [], answer: null, cardId: null });
    game.skipCard('a');
    expect(view(game, 'c').round!.skipped).toBe(2);
  });

  it('is only for the card holder, and only before the card is chosen', () => {
    const game = lobby();
    game.start('a');
    expect(code(() => game.skipCard('b'))).toBe('onlyHolder');
    game.chooseCard('a');
    expect(code(() => game.skipCard('a'))).toBe('tooLateToSkip');
    game.chooseTip('b', 0);
    expect(code(() => game.skipCard('a'))).toBe('tooLateToSkip');
    game.pass('b');
    expect(code(() => game.skipCard('a'))).toBe('tooLateToSkip');
    finishRound(game);
    expect(code(() => game.skipCard('a'))).toBe('noRound');
  });

  it('never brings back a card skipped in this room until every card has been used', () => {
    const game = lobby(['Ana', 'Bob']);
    game.start('a');
    const seen = [current(game)];
    for (let i = 0; i < 4; i++) {
      game.skipCard('a');
      seen.push(current(game));
    }
    expect(new Set(seen).size).toBe(5);
  });

  it('starts the time for the player on turn only once the card is chosen', () => {
    const clock = { now: 0 };
    const game = new Game('TEST', cards, zero, { layout: noSpecials, now: () => clock.now });
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    game.configure('a', { goal: 60, specials: { individual: 0, back: 0, forward: 0, dead: 0, win: 0 }, timers: { tip: 30, guess: 0 } });
    game.start('a');
    expect(view(game).round!.timer).toBeNull();
    clock.now += 20_000;
    game.skipCard('a');
    clock.now += 20_000;
    expect(view(game).round!.timer).toBeNull();
    game.chooseCard('a');
    expect(view(game).round!.timer).toEqual({ limitMs: 30_000, leftMs: 30_000 });
  });
});

describe('choosing the card', () => {
  it('comes first: nobody can pick a tip until the card holder has chosen the card', () => {
    const game = lobby();
    game.start('a');
    expect(view(game, 'b').round).toMatchObject({ cardChosen: false, turnId: 'b' });
    expect(code(() => game.chooseTip('b', 0))).toBe('cardNotChosen');
    expect(code(() => game.chooseCard('b'))).toBe('onlyHolder');
    game.chooseCard('a');
    expect(view(game, 'b').round!.cardChosen).toBe(true);
    expect(code(() => game.chooseCard('a'))).toBe('cardAlreadyChosen');
    game.chooseTip('b', 0);
    expect(view(game).phase).toBe('guessing');
  });

  it('is needed again in every round', () => {
    const game = lobby(['Ana', 'Bob']);
    game.start('a');
    finishRound(game);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ number: 2, holderId: 'b', cardChosen: false });
    expect(code(() => game.chooseTip('a', 0))).toBe('cardNotChosen');
  });

  it('is done by whoever holds the card of an individual question too', () => {
    const game = new Game('TEST', cards, zero, { layout: () => [{ index: 15, kind: 'individual' as const }] });
    ['Ana', 'Bob', 'Cy'].forEach((n, i) => game.addPlayer('abc'[i], n));
    game.start('a');
    game.chooseCard('a');
    for (let i = 0; i < 5; i++) {
      const who = view(game).round!.turnId!;
      game.chooseTip(who, i);
      if (i < 4) game.pass(who);
    }
    game.guess('b', view(game, 'a').round!.answer!); // b to 15: individual question
    game.nextRound('a');
    const holder = view(game).round!.holderId;
    expect(view(game).round).toMatchObject({ kind: 'individual', cardChosen: false });
    expect(code(() => game.chooseTip('b', 0))).toBe('cardNotChosen');
    game.skipCard(holder);
    game.chooseCard(holder);
    game.chooseTip('b', 0);
  });
});

describe('a card written by the card holder', () => {
  const own = (over: Record<string, unknown> = {}) => ({
    category: 'person',
    answer: '  My   Grandmother ',
    aliases: ['Grandma', '  ', 'Vovó'],
    tips: Array.from({ length: 20 }, (_, i) => ` Own tip   ${i + 1} `),
    ...over,
  });

  it('replaces the card drawn and settles the choice, so the others can pick tips', () => {
    const game = lobby();
    game.start('a');
    game.useOwnCard('a', own());
    const round = view(game, 'b').round!;
    expect(round).toMatchObject({ ownCard: true, cardChosen: true, category: 'person', answer: null });
    expect(view(game, 'a').round!.answer).toBe('My Grandmother');
    expect(view(game, 'a').round!.tips[0]).toBe('Own tip 1');
    game.chooseTip('b', 4);
    // shown as written, whatever the language of the player
    expect(game.viewFor('c', 'pt-BR').round!.tips[4]).toBe('Own tip 5');
    expect(game.viewFor('c', 'en').round!.tips[4]).toBe('Own tip 5');
  });

  it('is guessed like any card, with its other accepted answers', () => {
    const game = lobby();
    game.start('a');
    game.useOwnCard('a', own());
    game.chooseTip('b', 0);
    expect(game.guess('b', 'my uncle')).toBe(false);
    game.chooseTip('c', 1);
    expect(game.guess('c', 'vovo')).toBe(true);
    expect(view(game).result).toMatchObject({ reason: 'guessed', winnerId: 'c', answer: 'My Grandmother', guesserPoints: 18, holderPoints: 2 });
  });

  it('is only for the card holder, before the card is chosen', () => {
    const game = lobby();
    game.start('a');
    expect(code(() => game.useOwnCard('b', own()))).toBe('onlyHolder');
    game.chooseCard('a');
    expect(code(() => game.useOwnCard('a', own()))).toBe('cardAlreadyChosen');
  });

  it('must have a category, an answer and 20 tips', () => {
    const game = lobby();
    game.start('a');
    expect(code(() => game.useOwnCard('a', own({ category: 'animal' })))).toBe('invalidCard');
    expect(code(() => game.useOwnCard('a', own({ answer: '   ' })))).toBe('invalidCard');
    expect(code(() => game.useOwnCard('a', own({ tips: own().tips.slice(0, 19) })))).toBe('invalidCard');
    expect(code(() => game.useOwnCard('a', own({ tips: [...own().tips.slice(0, 19), ' '] })))).toBe('invalidCard');
    expect(code(() => game.useOwnCard('a', own({ tips: 'twenty tips' })))).toBe('invalidCard');
    expect(code(() => game.useOwnCard('a', null))).toBe('invalidCard');
    expect(view(game).round).toMatchObject({ ownCard: false, cardChosen: false });
    game.useOwnCard('a', own({ aliases: undefined })); // the other answers are optional
    expect(view(game).round!.ownCard).toBe(true);
  });

  it('is cut to a sensible length', () => {
    const game = lobby();
    game.start('a');
    game.useOwnCard('a', own({ answer: 'x'.repeat(500), tips: own().tips.map(() => 'y'.repeat(500)) }));
    expect(view(game, 'a').round!.answer).toHaveLength(60);
    expect(view(game, 'a').round!.tips[0]).toHaveLength(160);
  });

  it('does not count as one of the game’s cards that the players have seen', () => {
    const game = lobby(['Ana', 'Bob']);
    game.start('a');
    const drawn = current(game);
    game.useOwnCard('a', own());
    finishRound(game);
    expect(view(game, 'a').seenCards).toEqual([drawn]); // only the one she was dealt first
    expect(view(game, 'b').seenCards).toEqual([]);
    game.nextRound('a');
    expect(view(game).round).toMatchObject({ ownCard: false, cardChosen: false });
  });
});

describe('cards a player has already seen', () => {
  it('are not drawn again when there are others', () => {
    const game = lobby();
    game.rememberCards('a', ids.slice(0, 2));
    game.rememberCards('b', [ids[2]]);
    game.start('a');
    expect(current(game)).toBe(ids[3]); // the first card nobody has seen
  });

  it('are drawn as rarely as possible when every card has been seen by someone', () => {
    const game = lobby();
    game.rememberCards('a', ids.slice(0, 4));
    game.rememberCards('b', [ids[0], ids[1], ids[4]]);
    game.rememberCards('c', [ids[0], ids[3]]);
    // seen by: 1 -> 3 players, 2 -> 2, 3 -> 1, 4 -> 2, 5 -> 1
    game.start('a');
    expect([ids[2], ids[4]]).toContain(current(game));
  });

  it('are told to each player: the card holder as the card is drawn, everybody when it is shown', () => {
    const game = lobby();
    game.start('a');
    const card = current(game);
    expect(view(game, 'a').seenCards).toEqual([card]);
    expect(view(game, 'b').seenCards).toEqual([]);
    expect(view(game, 'b').round!.cardId).toBeNull();
    finishRound(game);
    expect(view(game, 'b').seenCards).toEqual([card]);
    expect(view(game, 'b').round!.cardId).toBe(card);
    expect(view(game, 'b').cardCount).toBe(5);
  });

  it('include cards the card holder skipped, for the card holder only', () => {
    const game = lobby();
    game.start('a');
    const skipped = current(game);
    game.skipCard('a');
    expect(view(game, 'a').seenCards).toEqual([skipped, current(game)]);
    expect(view(game, 'b').seenCards).toEqual([]);
  });

  it('start again from none once a player has seen every card', () => {
    const game = lobby(['Ana', 'Bob']);
    game.rememberCards('b', ids.slice(0, 4));
    game.start('a'); // the 5th card, so Bob will have seen all of them
    expect(current(game)).toBe(ids[4]);
    finishRound(game);
    expect(view(game, 'b').seenCards).toEqual([]);
    expect(view(game, 'a').seenCards).toEqual([ids[4]]);
  });

  it('ignore ids that are not cards of the game, and anything that is not a list', () => {
    const game = lobby();
    game.rememberCards('a', ['nope', 42, ids[0], null]);
    game.rememberCards('b', 'everything');
    expect(view(game, 'a').seenCards).toEqual([ids[0]]);
    expect(view(game, 'b').seenCards).toEqual([]);
    expect(code(() => game.rememberCards('zz', [ids[0]]))).toBe('notInRoom');
  });

  it('do not matter for players who left', () => {
    const game = lobby();
    game.rememberCards('c', ids.slice(0, 4));
    game.removePlayer('c');
    game.start('a');
    expect(current(game)).toBe(ids[0]);
  });
});
