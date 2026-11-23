import { Game, GameError } from '../src/game/Game';
import { noSpecials, testCards, zero, QuickGame } from './helpers';

/** A started game with players a, b, c (a is host). With the "zero" random source, a holds the first card. */
function started(names = ['Ana', 'Bob', 'Cy'], goal?: number) {
  const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
  const ids = names.map((_, i) => 'abcdefgh'[i]);
  names.forEach((name, i) => game.addPlayer(ids[i], name));
  game.start('a', goal);
  return game;
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameError) return e.code;
    throw e;
  }
  return null;
};

const view = (game: Game, id = 'a') => game.viewFor(id, 'en');
const pos = (game: Game) => Object.fromEntries(view(game).players.map((p) => [p.id, p.position]));
/** The answer of the card in play (the holder can see it). */
const answer = (game: Game) => view(game, view(game).round!.holderId).round!.answer!;

/** Reveals tips, everybody passing, until `count` tips are on the table and it is somebody's turn to guess. */
function revealTips(game: Game, count: number) {
  for (let i = view(game).round!.revealed.length; i < count; i++) {
    if (view(game).phase === 'guessing') game.pass(view(game).round!.turnId!);
    game.chooseTip(view(game).round!.turnId!, i);
  }
}

describe('lobby', () => {
  it('makes the first player the host and validates names', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    game.addPlayer('a', '  Ana  ');
    expect(view(game).hostId).toBe('a');
    expect(view(game).players[0].name).toBe('Ana');
    expect(code(() => game.addPlayer('b', '   '))).toBe('nameRequired');
    expect(code(() => game.addPlayer('b', 'ana'))).toBe('nameTaken');
    expect(code(() => game.addPlayer('b', 42))).toBe('nameRequired');
  });

  it('needs two players and the host to start', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    game.addPlayer('a', 'Ana');
    expect(code(() => game.start('a'))).toBe('notEnoughPlayers');
    game.addPlayer('b', 'Bob');
    expect(code(() => game.start('b'))).toBe('onlyHost');
    expect(code(() => game.start('a', 5))).toBe('invalidGoal');
    expect(code(() => game.start('a', 30.5))).toBe('invalidGoal');
    game.start('a', 40);
    expect(view(game).phase).toBe('choosing');
    expect(view(game).goal).toBe(40);
    expect(code(() => game.addPlayer('c', 'Cy'))).toBe('gameAlreadyStarted');
  });

  it('refuses a 13th player', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    for (let i = 0; i < 12; i++) game.addPlayer(`p${i}`, `Player ${i}`);
    expect(code(() => game.addPlayer('x', 'One too many'))).toBe('roomFull');
  });
});

describe('token colours', () => {
  const colors = (game: Game) => Object.fromEntries(view(game).players.map((p) => [p.id, p.color]));

  it('gives every player a different colour on arrival', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    for (let i = 0; i < 12; i++) game.addPlayer(`p${i}`, `Player ${i}`);
    const all = view(game, 'p0').players.map((p) => p.color);
    expect(new Set(all).size).toBe(12);
    expect(all[0]).toBe('red');
  });

  it('lets a player pick a free colour, but not one somebody else has', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    expect(colors(game)).toEqual({ a: 'red', b: 'orange' });
    game.setColor('b', 'blue');
    expect(colors(game)).toEqual({ a: 'red', b: 'blue' });
    expect(code(() => game.setColor('a', 'blue'))).toBe('colorTaken');
    expect(code(() => game.setColor('a', 'magenta'))).toBe('invalidColor');
    expect(code(() => game.setColor('a', undefined))).toBe('invalidColor');
    expect(code(() => game.setColor('nobody', 'green'))).toBe('notInRoom');
    game.setColor('a', 'red'); // picking your own colour again is fine
    game.setColor('a', 'orange'); // the one Bob gave up is free again
    expect(colors(game)).toEqual({ a: 'orange', b: 'blue' });
  });

  it('gives a newcomer a colour nobody has, whatever the others picked', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    game.addPlayer('a', 'Ana');
    game.setColor('a', 'orange');
    game.addPlayer('b', 'Bob');
    game.addPlayer('c', 'Cy');
    expect(colors(game)).toEqual({ a: 'orange', b: 'red', c: 'yellow' });
    game.removePlayer('b');
    game.addPlayer('d', 'Di');
    expect(colors(game).d).toBe('red');
  });

  it('locks colours while a game is being played and frees them again in the lobby', () => {
    const game = started(['Ana', 'Bob'], 20);
    expect(code(() => game.setColor('a', 'green'))).toBe('colorLocked');
    revealTips(game, 20);
    game.pass('b');
    expect(code(() => game.setColor('a', 'green'))).toBe('colorLocked');
    game.playAgain('a');
    game.setColor('a', 'green');
    expect(colors(game)).toEqual({ a: 'green', b: 'orange' });
  });
});

describe('a round', () => {
  it('gives the card to one player and the first turn to the next', () => {
    const game = started();
    const round = view(game).round!;
    expect(round.holderId).toBe('a');
    expect(round.turnId).toBe('b');
    expect(round.number).toBe(1);
  });

  it('shows the answer and all tips only to the card holder', () => {
    const game = started();
    expect(view(game, 'a').round!.answer).toMatch(/^Answer/);
    expect(view(game, 'a').round!.tips.every((t) => typeof t === 'string')).toBe(true);
    expect(view(game, 'b').round!.answer).toBeNull();
    expect(view(game, 'b').round!.tips.every((t) => t === null)).toBe(true);
    expect(view(game, 'b').result).toBeNull();
  });

  it('reveals the chosen tip to everybody, in each player’s language', () => {
    const game = started();
    game.chooseTip('b', 6);
    expect(view(game).phase).toBe('guessing');
    expect(game.viewFor('c', 'en').round!.tips[6]).toMatch(/^Card \d tip 7$/);
    expect(game.viewFor('c', 'pt-BR').round!.tips[6]).toMatch(/^Carta \d dica 7$/);
    expect(game.viewFor('c', 'en').round!.tips.filter((t) => t !== null)).toHaveLength(1);
    expect(game.viewFor('a', 'pt-BR').round!.answer).toMatch(/^Resposta/);
  });

  it('enforces turns and phases', () => {
    const game = started();
    expect(code(() => game.chooseTip('c', 0))).toBe('notYourTurn');
    expect(code(() => game.chooseTip('a', 0))).toBe('notYourTurn');
    expect(code(() => game.guess('b', 'x'))).toBe('notGuessingPhase');
    expect(code(() => game.pass('b'))).toBe('notGuessingPhase');
    expect(code(() => game.chooseTip('b', 20))).toBe('invalidTip');
    expect(code(() => game.chooseTip('b', 1.5))).toBe('invalidTip');
    game.chooseTip('b', 0);
    expect(code(() => game.chooseTip('b', 1))).toBe('notChoosingPhase');
    expect(code(() => game.guess('c', 'x'))).toBe('notYourTurn');
    expect(code(() => game.guess('b', '  '))).toBe('guessRequired');
    expect(code(() => game.chooseTip('zzz', 1))).toBe('notChoosingPhase');
    game.pass('b');
    expect(code(() => game.chooseTip('c', 0))).toBe('tipAlreadyRevealed');
    expect(code(() => game.nextRound('a'))).toBe('roundNotOver');
  });

  it('passes the turn round the guessers, skipping the card holder', () => {
    const game = started();
    game.chooseTip('b', 0);
    expect(game.guess('b', 'wrong')).toBe(false);
    expect(view(game).round!.turnId).toBe('c');
    expect(view(game).phase).toBe('choosing');
    game.chooseTip('c', 1);
    game.pass('c');
    expect(view(game).round!.turnId).toBe('b');
    expect(view(game).round!.guesses).toEqual([{ id: 1, playerId: 'b', text: 'wrong', correct: false, tipsRevealed: 1 }]);
  });

  it('moves the guesser 20 - tips and the holder as many spaces as tips used (5 tips: 15 and 5)', () => {
    const game = started();
    revealTips(game, 5);
    const guesser = view(game).round!.turnId!;
    expect(game.guess(guesser, answer(game))).toBe(true);
    const v = view(game, 'c');
    expect(v.phase).toBe('roundEnd');
    expect(v.result).toMatchObject({ reason: 'guessed', winnerId: guesser, tipsUsed: 5, guesserPoints: 15, holderPoints: 5, holderId: 'a' });
    expect(v.result!.answer).toBe(answer(game));
    expect(v.round!.tips.every((t) => typeof t === 'string')).toBe(true);
    expect(pos(game)).toEqual({ a: 5, b: guesser === 'b' ? 15 : 0, c: guesser === 'c' ? 15 : 0 });
  });

  it('gives 19 and 1 for a guess on the first tip', () => {
    const game = started();
    game.chooseTip('b', 19);
    game.guess('b', answer(game).toUpperCase());
    expect(pos(game)).toEqual({ a: 1, b: 19, c: 0 });
  });

  it('gives the holder 20 when all the tips come out and nobody gets it', () => {
    const game = started();
    revealTips(game, 20);
    expect(view(game).phase).toBe('guessing');
    game.guess(view(game).round!.turnId!, 'no idea');
    expect(view(game).phase).toBe('roundEnd');
    expect(view(game).result).toMatchObject({ reason: 'noTipsLeft', winnerId: null, guesserPoints: 0, holderPoints: 20 });
    expect(pos(game)).toEqual({ a: 20, b: 0, c: 0 });
  });

  it('gives the guesser nothing for a guess on the 20th tip', () => {
    const game = started();
    revealTips(game, 20);
    const guesser = view(game).round!.turnId!;
    game.guess(guesser, answer(game));
    expect(view(game).result).toMatchObject({ reason: 'guessed', guesserPoints: 0, holderPoints: 20 });
  });

  it('hands the card to the next player for the following round, with a new card', () => {
    const game = started();
    const first = answer(game);
    game.chooseTip('b', 0);
    game.guess('b', first);
    expect(code(() => game.nextRound('c'))).toBe('onlyHostOrHolder');
    game.nextRound('a');
    const round = view(game).round!;
    expect(round).toMatchObject({ number: 2, holderId: 'b', turnId: 'c', revealed: [], guesses: [] });
    expect(answer(game)).not.toBe(first);
    expect(view(game).result).toBeNull();
    expect(view(game, 'a').round!.answer).toBeNull();
  });

  it('goes through every card before repeating one', () => {
    const game = started(['Ana', 'Bob'], 300);
    const seen: string[] = [];
    for (let i = 0; i < testCards.length * 2; i++) {
      seen.push(answer(game));
      revealTips(game, 20);
      game.pass(view(game).round!.turnId!);
      game.nextRound('a');
    }
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(new Set(seen.slice(3)).size).toBe(3);
  });

  it('works with two players: the only guesser keeps the turn', () => {
    const game = started(['Ana', 'Bob']);
    game.chooseTip('b', 0);
    game.pass('b');
    expect(view(game).round!.turnId).toBe('b');
    expect(view(game).phase).toBe('choosing');
  });
});

describe('the card holder accepting a guess', () => {
  it('counts a guess the computer refused, with the tips there were at the time', () => {
    const game = started();
    game.chooseTip('b', 0);
    game.guess('b', 'close enough');
    game.chooseTip('c', 1);
    game.pass('c');
    game.chooseTip('b', 2);
    expect(code(() => game.acceptGuess('b', 1))).toBe('onlyHolder');
    expect(code(() => game.acceptGuess('a', 99))).toBe('guessNotFound');
    game.acceptGuess('a', 1);
    expect(view(game).result).toMatchObject({ reason: 'guessed', winnerId: 'b', tipsUsed: 1, guesserPoints: 19, holderPoints: 1 });
    expect(pos(game)).toEqual({ a: 1, b: 19, c: 0 });
    expect(view(game).round!.guesses[0].correct).toBe(true);
    expect(code(() => game.acceptGuess('a', 1))).toBe('noRound');
  });

  it('can still be done right after the last tip, replacing the holder’s 20 spaces', () => {
    const game = started(['Ana', 'Bob', 'Cy'], 20);
    revealTips(game, 20);
    const guesser = view(game).round!.turnId!;
    game.guess(guesser, 'tpyo');
    expect(view(game).phase).toBe('finished');
    expect(view(game).winnerId).toBe('a');
    game.acceptGuess('a', 1);
    expect(view(game).result).toMatchObject({ reason: 'guessed', winnerId: guesser, guesserPoints: 0, holderPoints: 20 });
    expect(pos(game).a).toBe(20);
  });
});

describe('winning', () => {
  it('ends when a player reaches the goal, and never moves past it', () => {
    const game = started(['Ana', 'Bob'], 30);
    game.chooseTip('b', 0);
    game.guess('b', answer(game)); // b 19, a 1
    game.nextRound('a'); // b holds
    expect(view(game).round!.holderId).toBe('b');
    revealTips(game, 20);
    game.pass('a'); // b +20 -> 30 (capped from 39)
    const v = view(game);
    expect(v.phase).toBe('finished');
    expect(v.winnerId).toBe('b');
    expect(pos(game)).toEqual({ a: 1, b: 30 });
    expect(code(() => game.nextRound('a'))).toBe('roundNotOver');
  });

  it('lets the guesser win when both reach the goal on the same card', () => {
    const game = started(['Ana', 'Bob'], 20);
    revealTips(game, 10);
    game.guess('b', answer(game)); // a 10, b 10
    game.nextRound('a');
    revealTips(game, 10);
    game.guess('a', answer(game)); // both 20
    expect(pos(game)).toEqual({ a: 20, b: 20 });
    expect(view(game).winnerId).toBe('a');
  });

  it('can be played again from the lobby with scores cleared', () => {
    const game = started(['Ana', 'Bob'], 20);
    revealTips(game, 20);
    game.pass('b');
    expect(view(game).phase).toBe('finished');
    expect(code(() => game.playAgain('b'))).toBe('onlyHost');
    game.playAgain('a');
    expect(view(game)).toMatchObject({ phase: 'lobby', round: null, result: null, winnerId: null });
    expect(pos(game)).toEqual({ a: 0, b: 0 });
    game.addPlayer('c', 'Cy');
    game.start('a');
    expect(view(game).phase).toBe('choosing');
  });
});

describe('players dropping out', () => {
  it('skips a guesser who is away and gives the turn back when needed', () => {
    const game = started();
    game.setConnected('b', false);
    expect(view(game).round!.turnId).toBe('c');
    expect(view(game).players.find((p) => p.id === 'b')!.connected).toBe(false);
    game.chooseTip('c', 0);
    game.pass('c');
    expect(view(game).round!.turnId).toBe('c');
    game.setConnected('b', true);
    game.chooseTip('c', 1);
    game.pass('c');
    expect(view(game).round!.turnId).toBe('b');
  });

  it('waits when no guesser is connected and resumes when one comes back', () => {
    const game = started(['Ana', 'Bob']);
    game.chooseTip('b', 0);
    game.setConnected('b', false);
    // nobody else can play: the turn waits for b, who keeps the guess they were about to make
    expect(view(game).round!.turnId).toBe('b');
    game.setConnected('b', true);
    expect(view(game).round!.turnId).toBe('b');
    expect(view(game).phase).toBe('guessing');
    expect(game.guess('b', 'something')).toBe(false);
  });

  it('gives the turn to a guesser who arrives while the one on turn is away', () => {
    const game = started();
    game.setConnected('c', false);
    game.setConnected('b', false);
    expect(view(game).round!.turnId).toBe('b');
    game.setConnected('c', true);
    expect(view(game).round!.turnId).toBe('c');
  });

  it('waits with nobody on turn when the only guesser leaves for good', () => {
    const game = started();
    game.setConnected('c', false);
    game.removePlayer('b');
    expect(view(game).round!.turnId).toBeNull();
    game.setConnected('c', true);
    expect(view(game).round!.turnId).toBe('c');
  });

  it('ends the round without points when the card holder goes away', () => {
    const game = started();
    game.chooseTip('b', 0);
    game.setConnected('a', false);
    expect(view(game).phase).toBe('roundEnd');
    expect(view(game).result).toMatchObject({ reason: 'holderLeft', winnerId: null, guesserPoints: 0, holderPoints: 0 });
    expect(pos(game)).toEqual({ a: 0, b: 0, c: 0 });
    expect(view(game).hostId).toBe('b');
    game.nextRound('b');
    expect(view(game).round!.holderId).toBe('b');
    expect(view(game).round!.turnId).toBe('c');
  });

  it('moves the host role when the host leaves for good', () => {
    const game = started();
    game.removePlayer('a');
    expect(view(game, 'b').players.map((p) => p.id)).toEqual(['b', 'c']);
    expect(view(game, 'b').hostId).toBe('b');
    expect(code(() => game.chooseTip('a', 0))).toBe('noRound');
  });

  it('does not start the next round with a single connected player', () => {
    const game = started(['Ana', 'Bob']);
    game.chooseTip('b', 0);
    game.guess('b', answer(game));
    game.setConnected('b', false);
    expect(code(() => game.nextRound('a'))).toBe('notEnoughPlayers');
  });

  it('drops players who are away when a game starts', () => {
    const game = new QuickGame('TEST', testCards, zero, { layout: noSpecials });
    game.addPlayer('a', 'Ana');
    game.addPlayer('b', 'Bob');
    game.addPlayer('c', 'Cy');
    game.setConnected('c', false);
    game.start('a');
    expect(view(game).players.map((p) => p.id)).toEqual(['a', 'b']);
    expect(game.hasPlayer('c')).toBe(false);
  });
});
