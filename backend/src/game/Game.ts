import { isCorrectGuess } from './answer';
import { Layout, randomLayout } from './board';
import { Rng, shuffle } from './shuffle';
import {
  Card,
  CardLang,
  CATEGORIES,
  Category,
  MAX_ANSWER_LENGTH,
  MAX_OWN_ALIASES,
  MAX_TIP_LENGTH,
  OwnCard,
  DEFAULT_GOAL,
  defaultScoring,
  defaultSpecialCounts,
  defaultTimers,
  GameSettings,
  GameView,
  INDIVIDUAL_MAX_TIPS,
  Locale,
  MAX_GOAL,
  MAX_GUESS_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_POINTS,
  maxSpecialSpaces,
  MIN_GOAL,
  MIN_PLAYERS,
  Phase,
  PLAYER_COLORS,
  PlayerColor,
  RoundEndReason,
  RoundKind,
  RoundResultView,
  Scoring,
  SPECIAL_KINDS,
  SPECIAL_STEP,
  SpecialCounts,
  SpecialEffectView,
  SpecialKind,
  SpecialSpace,
  TIMER_CHOICES,
  Timers,
  BoardMode,
  TIPS_PER_CARD,
  totalSpecials,
} from '../types';

export { shuffle };
export type { Rng };

/** An action that the rules do not allow. `code` is a key in the translation files (errors.<code>). */
export class GameError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'GameError';
  }
}

interface Player {
  id: string;
  name: string;
  position: number;
  connected: boolean;
  color: PlayerColor;
}

interface Guess {
  id: number;
  playerId: string;
  text: string;
  correct: boolean;
  tipsRevealed: number;
}

interface Round {
  /** Different for every round and individual question of a room. */
  serial: number;
  /** How many cards the card holder has put aside in this round. */
  skipped: number;
  /** Whether the card holder has settled on the card; until then nobody can pick a tip. */
  cardChosen: boolean;
  /** Whether the card was written by the card holder. */
  ownCard: boolean;
  /** What the clock last did in this round (cleared by the next thing a player does). */
  timedOut: { playerId: string; action: 'tip' | 'pass' } | null;
  kind: RoundKind;
  number: number;
  /** Holds the card: the card owner of a normal round, or the player drawn to hold it in an individual question. */
  holderId: string;
  /** The player answering an individual question (null in a normal round). */
  solverId: string | null;
  turnId: string | null;
  card: Card;
  revealed: number[];
  guesses: Guess[];
}

interface Result {
  kind: RoundKind;
  reason: RoundEndReason;
  card: Card;
  holderId: string;
  winnerId: string | null;
  solverId: string | null;
  tipsUsed: number;
  guesserPoints: number;
  holderPoints: number;
  effects: SpecialEffectView[];
}

/** The state just before a round was settled, so that settling can be redone (see acceptGuess). */
interface Snapshot {
  positions: Map<string, number>;
  pending: string[];
  winnerId: string | null;
}

/** The methods of Game that change its state. */
const ACTIONS = [
  'addPlayer',
  'setColor',
  'setConnected',
  'removePlayer',
  'configure',
  'start',
  'chooseTip',
  'guess',
  'pass',
  'acceptGuess',
  'nextRound',
  'skipIndividual',
  'skipCard',
  'chooseCard',
  'useOwnCard',
  'rememberCards',
  'playAgain',
  'expire',
] as const;

export interface GameOptions {
  /** Where the special spaces go; random by default. */
  layout?: Layout;
  /** The clock (milliseconds); Date.now by default. */
  now?: () => number;
  /** How long a second of the time limits lasts, in milliseconds (tests make it shorter). */
  secondMs?: number;
}

export function cardLang(locale: Locale): CardLang {
  return locale === 'pt-BR' ? 'pt' : 'en';
}

export function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
}

/**
 * The rules of one room, with no knowledge of sockets.
 *
 * A round: one player holds a card (an answer and 20 tips). The other players take turns;
 * on their turn a player picks one of the hidden tips, which is shown to everybody, and
 * may then make one guess or pass. Whoever gets it right moves (20 - tips revealed) spaces
 * and the card holder moves as many spaces as tips were revealed. If all 20 tips come out
 * and nobody gets it, the holder moves 20. The card then goes to the next player.
 * The first player to reach the goal wins.
 *
 * Special spaces act on a player who lands on them by that normal movement (not on one moved
 * there by another special space or by an individual question): back 5, forward 5, back to the
 * start, instant win, or an individual question. An individual question is played after the
 * round: the player answers a new card alone with at most 5 tips, while another player, drawn
 * at random, holds it; a right answer after n tips moves them 12 - 2n spaces.
 */
export class Game {
  phase: Phase = 'lobby';
  hostId = '';
  goal = DEFAULT_GOAL;
  /** How many special spaces of each kind the next board gets (set by the host in the lobby). */
  private specialCounts: SpecialCounts = defaultSpecialCounts(DEFAULT_GOAL);
  /** How many spaces right guesses and holding the card are worth (set by the host in the lobby). */
  private scoring: Scoring = defaultScoring();
  winnerId: string | null = null;
  private players: Player[] = [];
  private round: Round | null = null;
  private result: Result | null = null;
  /** Cards drawn in this room since every card was last used; none of them is drawn again before then. */
  private drawn = new Set<string>();
  /** Cards each player has already seen (also in earlier games, as their browser tells us). */
  private seenBy = new Map<string, Set<string>>();
  private guessSeq = 0;
  private roundSeq = 0;
  private specials: SpecialSpace[] = [];
  /** Players waiting to play an individual question, in order. */
  private pending: string[] = [];
  /** Card owner of the last normal round; the card goes round the table from them. */
  private lastHolderId = '';
  private beforeSettling: Snapshot | null = null;
  private readonly layout: Layout;
  private readonly now: () => number;
  private readonly secondMs: number;
  /** Time limits, in seconds (0: none), set by the host in the lobby. */
  private timers: Timers = defaultTimers();
  /** Random board, or the one the host made (customBoard). */
  private boardMode: BoardMode = 'random';
  private customBoard: SpecialSpace[] = [];
  /** The turn the clock is running for, and when it runs out. */
  private timerKey: string | null = null;
  private timerEnd: number | null = null;
  private timerLimitMs = 0;
  private roundSerial = 0;
  /** Everybody who ever sat at this table, in the order they arrived (the card goes round in this order). */
  private seats: string[] = [];

  constructor(
    public readonly code: string,
    private readonly cards: Card[],
    private readonly rng: Rng = Math.random,
    options: GameOptions = {},
  ) {
    if (cards.length === 0) throw new Error('A game needs at least one card');
    this.layout = options.layout ?? randomLayout;
    this.now = options.now ?? Date.now;
    this.secondMs = options.secondMs ?? 1000;
    // Whatever a player (or the clock) does may begin a new turn: check the clock after each
    // action, so that a turn's time starts the moment the turn does.
    const self = this as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of ACTIONS) {
      const action = self[name].bind(this);
      self[name] = (...args: unknown[]) => {
        try {
          return action(...args);
        } finally {
          this.syncTimer();
        }
      };
    }
  }

  // ---------------------------------------------------------------- time limits

  /**
   * Starts the clock when a new turn begins, and stops it when there is nothing to time: no
   * limit, nobody on turn, or the player on turn is away (they get the full time on return).
   */
  private syncTimer(): void {
    const round = this.round;
    const playing = this.phase === 'choosing' || this.phase === 'guessing';
    const seconds = this.phase === 'choosing' ? this.timers.tip : this.timers.guess;
    const onTurn = this.players.find((p) => p.id === round?.turnId);
    const key =
      round && round.cardChosen && playing && seconds > 0 && onTurn?.connected
        ? `${round.serial}|${round.card.id}|${this.phase}|${onTurn.id}|${round.revealed.length}`
        : null;
    if (key === this.timerKey) return;
    this.timerKey = key;
    this.timerLimitMs = seconds * this.secondMs;
    this.timerEnd = key ? this.now() + this.timerLimitMs : null;
  }

  /** When the time of the player on turn runs out (milliseconds on the clock), or null if no clock is running. */
  get deadline(): number | null {
    this.syncTimer();
    return this.timerEnd;
  }

  /**
   * To be called when the deadline has passed: picks a random tip for a player who did not
   * pick one, or passes for a player who did not guess. Returns whether it did anything.
   */
  expire(): boolean {
    const deadline = this.deadline;
    const round = this.round;
    if (deadline === null || !round || !round.turnId || this.now() < deadline) return false;
    const playerId = round.turnId;
    if (this.phase === 'choosing') {
      const hidden = Array.from({ length: TIPS_PER_CARD }, (_, i) => i).filter((i) => !round.revealed.includes(i));
      this.chooseTip(playerId, hidden[Math.floor(this.rng() * hidden.length)]);
      round.timedOut = { playerId, action: 'tip' };
    } else {
      this.pass(playerId);
      round.timedOut = { playerId, action: 'pass' };
    }
    return true;
  }

  // ---------------------------------------------------------------- players

  get playerCount(): number {
    return this.players.length;
  }

  get connectedCount(): number {
    return this.players.filter((p) => p.connected).length;
  }

  hasPlayer(id: string): boolean {
    return this.players.some((p) => p.id === id);
  }

  addPlayer(id: string, rawName: unknown): void {
    const name = cleanName(rawName);
    if (!name) throw new GameError('nameRequired');
    if (this.phase !== 'lobby') throw new GameError('gameAlreadyStarted');
    if (this.players.length >= MAX_PLAYERS) throw new GameError('roomFull');
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError('nameTaken');
    // a room never has more players than there are colours, so one is always free
    const color = PLAYER_COLORS.find((c) => !this.players.some((p) => p.color === c)) as PlayerColor;
    this.players.push({ id, name, position: 0, connected: true, color });
    this.seats.push(id);
    if (!this.hostId) this.hostId = id;
  }

  /** A player picks the colour of their token. Only before the game starts, and only a free colour. */
  setColor(by: string, color: unknown): void {
    const player = this.player(by);
    if (this.phase !== 'lobby') throw new GameError('colorLocked');
    if (!PLAYER_COLORS.includes(color as PlayerColor)) throw new GameError('invalidColor');
    if (this.players.some((p) => p.id !== by && p.color === color)) throw new GameError('colorTaken');
    player.color = color as PlayerColor;
  }

  /** Marks a player as away (connection dropped) or back. Their seat and score are kept. */
  setConnected(id: string, connected: boolean): void {
    const player = this.player(id);
    if (player.connected === connected) return;
    player.connected = connected;
    if (!connected) this.afterPlayerGone(id);
    else this.fixTurn();
    this.fixHost();
  }

  /** Removes a player for good. */
  removePlayer(id: string): void {
    this.player(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.afterPlayerGone(id);
    this.fixHost();
  }

  private afterPlayerGone(id: string): void {
    if (!this.round || (this.phase !== 'choosing' && this.phase !== 'guessing')) return;
    if (this.round.kind === 'individual') {
      if (id === this.round.solverId) {
        // the question waits for its player, unless they left the game for good
        if (!this.hasPlayer(id)) this.endRound('solverLeft', null);
      } else if (id === this.round.holderId) {
        // somebody else takes the card; the player answering loses nothing
        this.round.holderId = this.pickHolderFor(this.round.solverId as string) ?? id;
        this.markSeen([this.round.holderId], this.round.card);
      }
      return;
    }
    if (this.round.holderId === id) {
      this.endRound('holderLeft', null);
    } else if (this.round.turnId === id) {
      // Pass the turn on if somebody else can play. If not, the round waits for this player,
      // who finds it exactly as they left it (a page reload does not cost them their guess).
      const others = this.players.some((p) => p.connected && p.id !== id && p.id !== this.round?.holderId);
      if (others || !this.hasPlayer(id)) this.advanceTurn();
    }
  }

  private fixHost(): void {
    const host = this.players.find((p) => p.id === this.hostId);
    if (host?.connected) return;
    const next = this.players.find((p) => p.connected) ?? host ?? this.players[0];
    this.hostId = next ? next.id : '';
  }

  // ---------------------------------------------------------------- actions

  /**
   * The host sets the options of the next game: the size of the board and how many special
   * spaces of each kind it gets (at most one per space between the start and the finish).
   */
  configure(by: string, raw: unknown): void {
    this.player(by);
    if (this.phase !== 'lobby') throw new GameError('gameAlreadyStarted');
    if (by !== this.hostId) throw new GameError('onlyHost');
    const settings = (raw ?? {}) as Partial<GameSettings>;
    const goal = settings.goal;
    if (!Number.isInteger(goal) || (goal as number) < MIN_GOAL || (goal as number) > MAX_GOAL) throw new GameError('invalidGoal');
    const specials = settings.specials as Partial<SpecialCounts> | undefined;
    if (!specials || typeof specials !== 'object') throw new GameError('invalidSpecials');
    const counts = {} as SpecialCounts;
    for (const kind of SPECIAL_KINDS) {
      const n = specials[kind];
      if (!Number.isInteger(n) || (n as number) < 0) throw new GameError('invalidSpecials');
      counts[kind] = n as number;
    }
    if (totalSpecials(counts) > maxSpecialSpaces(goal as number)) throw new GameError('tooManySpecials');
    // the points are optional: left out, they stay as they are
    const scoring = settings.scoring === undefined ? this.scoring : Game.checkScoring(settings.scoring);
    // so are the time limits
    let timers = this.timers;
    if (settings.timers !== undefined) {
      const t = (settings.timers ?? {}) as Partial<Timers>;
      if (!TIMER_CHOICES.includes(t.tip as number) || !TIMER_CHOICES.includes(t.guess as number)) throw new GameError('invalidTimers');
      timers = { tip: t.tip as number, guess: t.guess as number };
    }
    // the kind of board and the host's own board are optional too
    const boardMode = settings.boardMode === undefined ? this.boardMode : settings.boardMode;
    if (boardMode !== 'random' && boardMode !== 'custom') throw new GameError('invalidBoard');
    const customBoard =
      settings.customBoard === undefined
        ? // a board made for another size keeps the special spaces that still fit
          this.customBoard.filter((s) => s.index < (goal as number))
        : Game.checkBoard(settings.customBoard, goal as number);
    this.goal = goal as number;
    this.specialCounts = counts;
    this.scoring = scoring;
    this.timers = timers;
    this.boardMode = boardMode;
    this.customBoard = customBoard;
  }

  /** A board made by the host: special spaces on different spaces between the start and the finish. */
  private static checkBoard(raw: unknown, goal: number): SpecialSpace[] {
    if (!Array.isArray(raw)) throw new GameError('invalidBoard');
    const seen = new Set<number>();
    const board = raw.map((s: Partial<SpecialSpace> | null) => {
      const index = s?.index as number;
      if (!Number.isInteger(index) || index < 1 || index >= goal || seen.has(index)) throw new GameError('invalidBoard');
      if (!SPECIAL_KINDS.includes(s?.kind as SpecialKind)) throw new GameError('invalidBoard');
      seen.add(index);
      return { index, kind: s!.kind as SpecialKind };
    });
    return board.sort((a, b) => a.index - b.index);
  }

  private static checkScoring(raw: unknown): Scoring {
    const s = (raw ?? {}) as Partial<Scoring>;
    const points = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_POINTS;
    const list = (l: unknown, length: number) => Array.isArray(l) && l.length === length && l.every(points);
    if (
      !list(s.guesser, TIPS_PER_CARD) ||
      !list(s.holder, TIPS_PER_CARD) ||
      !points(s.nobody) ||
      !list(s.individual, INDIVIDUAL_MAX_TIPS)
    ) {
      throw new GameError('invalidScoring');
    }
    return { guesser: [...s.guesser!], holder: [...s.holder!], nobody: s.nobody!, individual: [...s.individual!] };
  }

  start(by: string, goal?: number): void {
    this.player(by);
    if (this.phase !== 'lobby') throw new GameError('gameAlreadyStarted');
    if (by !== this.hostId) throw new GameError('onlyHost');
    if (this.connectedCount < MIN_PLAYERS) throw new GameError('notEnoughPlayers');
    if (goal !== undefined && goal !== this.goal) {
      // a new board size brings back the default special spaces for it
      this.configure(by, { goal, specials: defaultSpecialCounts(goal) });
    }
    this.players = this.players.filter((p) => p.connected);
    for (const p of this.players) p.position = 0;
    this.winnerId = null;
    this.result = null;
    this.roundSeq = 0;
    this.pending = [];
    this.specials =
      this.boardMode === 'custom'
        ? this.customBoard.map((s) => ({ ...s }))
        : this.layout(this.goal, this.rng, { ...this.specialCounts });
    this.startRound(this.players[Math.floor(this.rng() * this.players.length)].id);
  }

  chooseTip(by: string, index: number): void {
    const round = this.activeRound();
    if (this.phase !== 'choosing') throw new GameError('notChoosingPhase');
    if (!round.cardChosen) throw new GameError('cardNotChosen');
    if (by !== round.turnId) throw new GameError('notYourTurn');
    if (!Number.isInteger(index) || index < 0 || index >= TIPS_PER_CARD) throw new GameError('invalidTip');
    if (round.revealed.includes(index)) throw new GameError('tipAlreadyRevealed');
    if (round.revealed.length >= this.maxTips(round)) throw new GameError('invalidTip');
    round.timedOut = null;
    round.revealed.push(index);
    this.phase = 'guessing';
  }

  /** Returns true when the guess was right (which ends the round). */
  guess(by: string, rawText: unknown): boolean {
    const round = this.activeRound();
    if (this.phase !== 'guessing') throw new GameError('notGuessingPhase');
    if (by !== round.turnId) throw new GameError('notYourTurn');
    const text = typeof rawText === 'string' ? rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS_LENGTH) : '';
    if (!text) throw new GameError('guessRequired');
    round.timedOut = null;
    const correct = isCorrectGuess(round.card, text);
    round.guesses.push({ id: ++this.guessSeq, playerId: by, text, correct, tipsRevealed: round.revealed.length });
    if (correct) this.endRound('guessed', by, round.revealed.length);
    else this.advanceTurn();
    return correct;
  }

  pass(by: string): void {
    const round = this.activeRound();
    if (this.phase !== 'guessing') throw new GameError('notGuessingPhase');
    if (by !== round.turnId) throw new GameError('notYourTurn');
    round.timedOut = null;
    this.advanceTurn();
  }

  /**
   * Lets the card holder count a guess the computer judged wrong (a typo, another name for the
   * same thing). Points are worked out from the number of tips on the table when it was made.
   */
  acceptGuess(by: string, guessId: number): void {
    const round = this.round;
    if (!round) throw new GameError('noRound');
    if (by !== round.holderId) throw new GameError('onlyHolder');
    // Also allowed right after the last tip went by with nobody getting it.
    const ended = (this.phase === 'roundEnd' || this.phase === 'finished') && this.result?.reason === 'noTipsLeft';
    if (this.phase !== 'choosing' && this.phase !== 'guessing' && !ended) throw new GameError('noRound');
    const guess = round.guesses.find((g) => g.id === guessId);
    if (!guess || !this.hasPlayer(guess.playerId)) throw new GameError('guessNotFound');
    if (ended) {
      // undo "nobody got it": the holder's 20 spaces and whatever special space they led to
      this.restore();
    }
    guess.correct = true;
    this.endRound('guessed', guess.playerId, guess.tipsRevealed);
  }

  nextRound(by: string): void {
    this.player(by);
    if (this.phase !== 'roundEnd' || !this.result) throw new GameError('roundNotOver');
    if (by !== this.hostId && by !== this.result.holderId && by !== this.result.solverId) {
      throw new GameError('onlyHostOrHolder');
    }
    if (this.connectedCount < MIN_PLAYERS) throw new GameError('notEnoughPlayers');
    // individual questions won in the last round come first; a player who is away loses theirs
    while (this.pending.length > 0) {
      const solverId = this.pending.shift() as string;
      const solver = this.players.find((p) => p.id === solverId);
      if (solver?.connected && this.pickHolderFor(solverId)) {
        this.startIndividual(solverId);
        return;
      }
    }
    this.startRound(this.nextHolder(this.lastHolderId));
  }

  /**
   * Cancels an individual question whose player is away, so that the others are not stuck
   * waiting for them. The host or the player holding the card can do it.
   */
  skipIndividual(by: string): void {
    const round = this.activeRound();
    if (round.kind !== 'individual') throw new GameError('noIndividual');
    if (by !== this.hostId && by !== round.holderId) throw new GameError('onlyHostOrHolder');
    if (this.players.find((p) => p.id === round.solverId)?.connected) throw new GameError('solverIsHere');
    this.endRound('solverLeft', null);
  }

  /** Back to the lobby with the same players, scores cleared. */
  playAgain(by: string): void {
    this.player(by);
    if (this.phase !== 'finished') throw new GameError('gameNotOver');
    if (by !== this.hostId) throw new GameError('onlyHost');
    this.players = this.players.filter((p) => p.connected);
    for (const p of this.players) p.position = 0;
    this.phase = 'lobby';
    this.round = null;
    this.result = null;
    this.winnerId = null;
    this.pending = [];
    this.specials = [];
  }

  // ---------------------------------------------------------------- internals

  private player(id: string): Player {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new GameError('notInRoom');
    return p;
  }

  private activeRound(): Round {
    if (!this.round || (this.phase !== 'choosing' && this.phase !== 'guessing')) throw new GameError('noRound');
    return this.round;
  }

  /**
   * Draws a card not drawn in this room yet, preferring one that none of the players has seen
   * (or, failing that, as few of them as possible).
   */
  private drawCard(): Card {
    let pool = this.cards.filter((c) => !this.drawn.has(c.id));
    if (pool.length === 0) {
      this.drawn.clear();
      pool = [...this.cards];
    }
    const seenCount = (card: Card) => this.players.filter((p) => this.seenBy.get(p.id)?.has(card.id)).length;
    const fewest = Math.min(...pool.map(seenCount));
    const choices = pool.filter((c) => seenCount(c) === fewest);
    const card = choices[Math.floor(this.rng() * choices.length)];
    this.drawn.add(card.id);
    return card;
  }

  /** Notes that these players have seen a card. Someone who has seen them all starts again from none. */
  private markSeen(playerIds: string[], card: Card): void {
    if (!this.cards.includes(card)) return; // a card written by a player is not one of the game's
    for (const id of playerIds) {
      const seen = this.seenBy.get(id) ?? new Set<string>();
      seen.add(card.id);
      if (seen.size >= this.cards.length) seen.clear();
      this.seenBy.set(id, seen);
    }
  }

  /** The cards a player has seen before (as kept by their browser), so that they are not drawn for them again. */
  rememberCards(playerId: string, ids: unknown): void {
    this.player(playerId);
    if (!Array.isArray(ids)) return;
    const known = new Set(this.cards.map((c) => c.id));
    const seen = this.seenBy.get(playerId) ?? new Set<string>();
    for (const id of ids) if (typeof id === 'string' && known.has(id)) seen.add(id);
    if (seen.size >= this.cards.length) seen.clear();
    this.seenBy.set(playerId, seen);
  }

  /**
   * The card holder puts the card aside and draws another one (too easy, too hard...). Only
   * before the first tip is shown.
   */
  skipCard(by: string): void {
    const round = this.activeRound();
    if (by !== round.holderId) throw new GameError('onlyHolder');
    if (round.cardChosen || this.phase !== 'choosing' || round.revealed.length > 0) throw new GameError('tooLateToSkip');
    round.card = this.drawCard();
    round.skipped++;
    this.markSeen([round.holderId], round.card);
  }

  /**
   * The card holder plays a card they wrote themselves instead of the one drawn: an answer, a
   * category and 20 tips, shown to everybody as written. Choosing it settles the card.
   */
  useOwnCard(by: string, raw: unknown): void {
    const round = this.activeRound();
    if (by !== round.holderId) throw new GameError('onlyHolder');
    if (round.cardChosen) throw new GameError('cardAlreadyChosen');
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const own = (raw ?? {}) as Partial<OwnCard>;
    const answer = text(own.answer, MAX_ANSWER_LENGTH);
    const tips = Array.isArray(own.tips) ? own.tips.map((tip) => text(tip, MAX_TIP_LENGTH)) : [];
    const aliases = Array.isArray(own.aliases) ? own.aliases.map((a) => text(a, MAX_ANSWER_LENGTH)).filter(Boolean).slice(0, MAX_OWN_ALIASES) : [];
    if (!CATEGORIES.includes(own.category as Category) || !answer || tips.length !== TIPS_PER_CARD || tips.some((tip) => !tip)) {
      throw new GameError('invalidCard');
    }
    round.card = {
      id: `custom-${round.serial}`,
      category: own.category as Category,
      answer: { en: answer, pt: answer },
      aliases: { en: aliases, pt: [] },
      tips: { en: tips, pt: tips },
    };
    round.ownCard = true;
    round.cardChosen = true;
  }

  /** The card holder settles on the card in hand: no more skipping, and the others can start picking tips. */
  chooseCard(by: string): void {
    const round = this.activeRound();
    if (by !== round.holderId) throw new GameError('onlyHolder');
    if (round.cardChosen) throw new GameError('cardAlreadyChosen');
    round.cardChosen = true;
  }

  /**
   * Connected players, starting just after the given one and going round the table. Works
   * from the seat the given player had even if they have left the game since.
   */
  private connectedAfter(id: string): Player[] {
    const i = this.seats.indexOf(id);
    const order = [...this.seats.slice(i + 1), ...this.seats.slice(0, Math.max(i, 0))];
    return order
      .map((seat) => this.players.find((p) => p.id === seat))
      .filter((p): p is Player => p !== undefined && p.connected);
  }

  private nextHolder(previousHolderId: string): string {
    const next = this.connectedAfter(previousHolderId)[0];
    if (next) return next.id;
    const any = this.players.find((p) => p.connected);
    if (!any) throw new GameError('notEnoughPlayers');
    return any.id;
  }

  private maxTips(round: Round): number {
    return round.kind === 'individual' ? INDIVIDUAL_MAX_TIPS : TIPS_PER_CARD;
  }

  /** A connected player, other than the one answering, drawn at random to hold an individual question's card. */
  private pickHolderFor(solverId: string): string | null {
    const candidates = this.players.filter((p) => p.connected && p.id !== solverId);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(this.rng() * candidates.length)].id;
  }

  private startRound(holderId: string): void {
    this.round = {
      serial: ++this.roundSerial,
      skipped: 0,
      cardChosen: false,
      ownCard: false,
      timedOut: null,
      kind: 'normal',
      number: ++this.roundSeq,
      holderId,
      solverId: null,
      turnId: null,
      card: this.drawCard(),
      revealed: [],
      guesses: [],
    };
    this.lastHolderId = holderId;
    this.result = null;
    this.beforeSettling = null;
    this.phase = 'choosing';
    this.round.turnId = this.connectedAfter(holderId)[0]?.id ?? null;
    this.markSeen([holderId], this.round.card);
  }

  private startIndividual(solverId: string): void {
    this.round = {
      serial: ++this.roundSerial,
      skipped: 0,
      cardChosen: false,
      ownCard: false,
      timedOut: null,
      kind: 'individual',
      number: this.roundSeq,
      holderId: this.pickHolderFor(solverId) as string,
      solverId,
      turnId: solverId,
      card: this.drawCard(),
      revealed: [],
      guesses: [],
    };
    this.result = null;
    this.beforeSettling = null;
    this.phase = 'choosing';
    this.markSeen([this.round.holderId], this.round.card);
  }

  /** Hands the turn to the next guesser, or ends the round when no tips are left. */
  private advanceTurn(): void {
    const round = this.round as Round;
    if (round.revealed.length >= this.maxTips(round)) {
      this.endRound('noTipsLeft', null);
      return;
    }
    if (round.kind === 'individual') {
      // an individual question is answered by one player only
      round.turnId = round.solverId;
      this.phase = 'choosing';
      return;
    }
    const from = round.turnId ?? round.holderId;
    const next = this.connectedAfter(from).filter((p) => p.id !== round.holderId)[0];
    // With a single guesser, the turn comes straight back to them.
    const self = this.players.find((p) => p.id === from && p.id !== round.holderId);
    round.turnId = next?.id ?? self?.id ?? null;
    this.phase = 'choosing';
  }

  /** Called when somebody comes back: if the round was waiting for a guesser, give them the turn. */
  private fixTurn(): void {
    if (!this.round || (this.phase !== 'choosing' && this.phase !== 'guessing')) return;
    if (this.round.kind === 'individual') {
      // the turn always stays with the player answering; but if nobody holds the card any more,
      // somebody who has come back can take it
      const holder = this.players.find((p) => p.id === this.round?.holderId);
      if (!holder?.connected) {
        this.round.holderId = this.pickHolderFor(this.round.solverId as string) ?? this.round.holderId;
        this.markSeen([this.round.holderId], this.round.card);
      }
      return;
    }
    const turn = this.players.find((p) => p.id === this.round?.turnId);
    if (!turn || !turn.connected) this.advanceTurn();
  }

  /** Ends the round: moves the players, applies special spaces, and checks for a winner. */
  private endRound(reason: RoundEndReason, winnerId: string | null, tipsUsed?: number): void {
    const round = this.round as Round;
    // everybody sees the answer now
    this.markSeen(
      this.players.map((p) => p.id),
      round.card,
    );
    this.beforeSettling = {
      positions: new Map(this.players.map((p) => [p.id, p.position])),
      pending: [...this.pending],
      winnerId: this.winnerId,
    };
    const used = tipsUsed ?? round.revealed.length;
    let guesserPoints = 0;
    let holderPoints = 0;
    if (round.kind === 'individual') {
      if (reason === 'guessed') guesserPoints = this.scoring.individual[used - 1] ?? 0;
    } else if (reason === 'guessed') {
      guesserPoints = this.scoring.guesser[used - 1] ?? 0;
      holderPoints = this.scoring.holder[used - 1] ?? 0;
    } else if (reason === 'noTipsLeft') {
      holderPoints = this.scoring.nobody;
    }
    // In an individual question the player holding the card never moves.
    const holder = round.kind === 'normal' ? this.players.find((p) => p.id === round.holderId) : undefined;
    const winner = this.players.find((p) => p.id === winnerId);
    const moved: Player[] = [];
    if (winner && guesserPoints > 0) {
      winner.position = Math.min(this.goal, winner.position + guesserPoints);
      moved.push(winner);
    }
    if (holder && holderPoints > 0) {
      holder.position = Math.min(this.goal, holder.position + holderPoints);
      moved.push(holder);
    }
    // Special spaces only act after the movement of a normal round, and never in a chain.
    const effects = round.kind === 'normal' ? moved.map((p) => this.landOn(p)).filter((e) => e !== null) : [];
    round.turnId = null;
    this.result = {
      kind: round.kind,
      reason,
      card: round.card,
      holderId: round.holderId,
      winnerId,
      solverId: round.solverId,
      tipsUsed: used,
      guesserPoints,
      holderPoints,
      effects,
    };
    this.phase = 'roundEnd';
    // The guesser crosses the line first when both get there on the same card.
    const champion = moved.find((p) => p.position >= this.goal);
    if (champion) {
      this.winnerId = champion.id;
      this.phase = 'finished';
      this.pending = [];
    }
  }

  /** Applies the special space a player has just landed on, if there is one. */
  private landOn(player: Player): SpecialEffectView | null {
    const special = this.specials.find((s) => s.index === player.position);
    if (!special) return null;
    const from = player.position;
    switch (special.kind) {
      case 'back':
        player.position = Math.max(0, from - SPECIAL_STEP);
        break;
      case 'forward':
        player.position = Math.min(this.goal, from + SPECIAL_STEP);
        break;
      case 'dead':
        player.position = 0;
        break;
      case 'win':
        player.position = this.goal;
        break;
      case 'individual':
        if (!this.pending.includes(player.id)) this.pending.push(player.id);
        break;
    }
    return { playerId: player.id, kind: special.kind, from, to: player.position };
  }

  /** Puts positions, waiting individual questions and the winner back as they were before the round was settled. */
  private restore(): void {
    const before = this.beforeSettling;
    if (!before) return;
    for (const p of this.players) p.position = before.positions.get(p.id) ?? p.position;
    this.pending = [...before.pending];
    this.winnerId = before.winnerId;
  }

  // ---------------------------------------------------------------- view

  /** What one player is allowed to see, in their language. */
  viewFor(playerId: string, locale: Locale): GameView {
    const lang = cardLang(locale);
    const round = this.round;
    const deadline = this.deadline;
    const over = this.phase === 'roundEnd' || this.phase === 'finished';
    const result: RoundResultView | null = this.result
      ? {
          kind: this.result.kind,
          reason: this.result.reason,
          answer: this.result.card.answer[lang],
          holderId: this.result.holderId,
          winnerId: this.result.winnerId,
          tipsUsed: this.result.tipsUsed,
          guesserPoints: this.result.guesserPoints,
          holderPoints: this.result.holderPoints,
          solverId: this.result.solverId,
          effects: this.result.effects.map((e) => ({ ...e })),
        }
      : null;
    return {
      code: this.code,
      phase: this.phase,
      you: playerId,
      hostId: this.hostId,
      goal: this.goal,
      settings: {
        goal: this.goal,
        boardMode: this.boardMode,
        specials: { ...this.specialCounts },
        customBoard: this.customBoard.map((s) => ({ ...s })),
        timers: { ...this.timers },
        scoring: {
          guesser: [...this.scoring.guesser],
          holder: [...this.scoring.holder],
          nobody: this.scoring.nobody,
          individual: [...this.scoring.individual],
        },
      },
      players: this.players.map((p) => ({ ...p })),
      round: round
        ? {
            kind: round.kind,
            number: round.number,
            maxTips: this.maxTips(round),
            holderId: round.holderId,
            turnId: round.turnId,
            category: round.card.category,
            tips: round.card.tips[lang].map((tip, i) =>
              over || playerId === round.holderId || round.revealed.includes(i) ? tip : null,
            ),
            revealed: [...round.revealed],
            guesses: round.guesses.map((g) => ({ ...g })),
            answer: over || playerId === round.holderId ? round.card.answer[lang] : null,
            cardId: over || playerId === round.holderId ? round.card.id : null,
            skipped: round.skipped,
            cardChosen: round.cardChosen,
            ownCard: round.ownCard,
            timer: deadline === null ? null : { limitMs: this.timerLimitMs, leftMs: Math.max(0, deadline - this.now()) },
            timedOut: over || !round.timedOut ? null : { ...round.timedOut },
          }
        : null,
      result,
      winnerId: this.winnerId,
      specials: this.specials.map((s) => ({ ...s })),
      pendingIndividual: this.pending.filter((id) => this.hasPlayer(id)),
      seenCards: [...(this.seenBy.get(playerId) ?? [])],
      cardCount: this.cards.length,
    };
  }
}
