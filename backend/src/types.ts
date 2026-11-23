// Types shared by the server and (as a copy in frontend/src/types.ts) by the client.

export type Locale = 'en' | 'pt-BR';
export const LOCALES: Locale[] = ['en', 'pt-BR'];

export type Category = 'thing' | 'person' | 'place' | 'year';
export const CATEGORIES: Category[] = ['thing', 'person', 'place', 'year'];

/** Language key used inside the card files. */
export type CardLang = 'en' | 'pt';

export interface Card {
  id: string;
  category: Category;
  answer: Record<CardLang, string>;
  aliases: Record<CardLang, string[]>;
  tips: Record<CardLang, string[]>;
}

/** Colours a player's token can have. There are as many as the most players a room takes. */
export const PLAYER_COLORS = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'purple',
  'pink',
  'brown',
  'white',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const TIPS_PER_CARD = 20;

/**
 * Special spaces of the board:
 * - individual: the player answers a card alone, with at most 5 tips (see individualPoints)
 * - back / forward: the player moves 5 spaces back / forward
 * - dead: the player goes back to the start
 * - win: the player goes to the finish and wins
 * They only act on a player who lands there by the normal movement of a round
 * (a right guess, or holding the card).
 */
export type SpecialKind = 'individual' | 'back' | 'forward' | 'dead' | 'win';
export const SPECIAL_KINDS: SpecialKind[] = ['individual', 'back', 'forward', 'dead', 'win'];

export interface SpecialSpace {
  index: number;
  kind: SpecialKind;
}

export type SpecialCounts = Record<SpecialKind, number>;

/**
 * The default number of special spaces of each kind for a track to the given goal. Spaces 1 to
 * goal-1 can be special (never the start or the finish): one individual question for every
 * 15 normal (not special) spaces, one "back 5" and one "forward 5" for every 20, and a single
 * dead space and a single instant win.
 */
export function defaultSpecialCounts(goal: number): SpecialCounts {
  const spaces = Math.max(0, goal - 1);
  // The number of normal spaces depends on how many are special. Of the counts that leave
  // enough normal spaces (15 per individual question, 20 per "back"/"forward"), take the ones
  // closest to those ratios.
  let best = { individual: 0, pairs: 0, gap: Infinity };
  for (let individual = 0; individual * 16 <= spaces; individual++) {
    for (let pairs = 0; pairs * 21 <= spaces; pairs++) {
      const normal = spaces - individual - 2 * pairs - 2;
      if (normal < 0 || individual * 15 > normal || pairs * 20 > normal) continue;
      const gap = normal / 15 - individual + normal / 20 - pairs;
      if (gap < best.gap) best = { individual, pairs, gap };
    }
  }
  return { individual: best.individual, back: best.pairs, forward: best.pairs, dead: 1, win: 1 };
}

/** The most special spaces a track to the given goal can have: every space but the start and the finish. */
export function maxSpecialSpaces(goal: number): number {
  return Math.max(0, goal - 1);
}

export function totalSpecials(counts: SpecialCounts): number {
  return SPECIAL_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
}

/** Most spaces a single score can be worth. */
export const MAX_POINTS = 300;

/**
 * How many spaces players move. Lists are indexed by the number of tips shown minus one
 * (guesser[0] is a right guess after 1 tip).
 */
export interface Scoring {
  /** Normal round, right guess after n tips: the player who guessed. 20 entries. */
  guesser: number[];
  /** Normal round, right guess after n tips: the card holder. 20 entries. */
  holder: number[];
  /** Normal round, all 20 tips shown and nobody got it: the card holder. */
  nobody: number;
  /** Individual question, right after n tips: the player answering (the card holder never moves). 5 entries. */
  individual: number[];
}

/** The standard points: guesser 20 - n, card holder n, nobody gets it 20, individual question 12 - 2n. */
export function defaultScoring(): Scoring {
  return {
    guesser: Array.from({ length: TIPS_PER_CARD }, (_, i) => TIPS_PER_CARD - (i + 1)),
    holder: Array.from({ length: TIPS_PER_CARD }, (_, i) => i + 1),
    nobody: TIPS_PER_CARD,
    individual: Array.from({ length: INDIVIDUAL_MAX_TIPS }, (_, i) => individualPoints(i + 1)),
  };
}

export function isDefaultScoring(scoring: Scoring): boolean {
  return JSON.stringify(scoring) === JSON.stringify(defaultScoring());
}

/** The time limits the host can choose from, in seconds. 0 means no limit. */
export const TIMER_CHOICES = [15, 30, 60, 120, 0];

/** Time a player has on their turn, in seconds (0: no limit). */
export interface Timers {
  /** To pick a tip. When it runs out, a tip is picked at random. */
  tip: number;
  /** To make a guess. When it runs out, the player passes. */
  guess: number;
}

export function defaultTimers(): Timers {
  return { tip: 0, guess: 0 };
}

/** How the board gets its special spaces: drawn at random, or placed by the host. */
export type BoardMode = 'random' | 'custom';

/** What the host sets up before a game starts. */
export interface GameSettings {
  /** Spaces from the start to the finish. */
  goal: number;
  /** random: the special spaces are drawn at random in the numbers below; custom: customBoard is used. */
  boardMode: BoardMode;
  /** How many special spaces of each kind a random board gets. */
  specials: SpecialCounts;
  /** The special spaces of a board made by the host, sorted by space (spaces 1 to goal-1). */
  customBoard: SpecialSpace[];
  /** How many spaces players move for right guesses and for holding the card. */
  scoring: Scoring;
  /** Time limits for picking a tip and for guessing. */
  timers: Timers;
}

/** Spaces moved by the "back" and "forward" special spaces. */
export const SPECIAL_STEP = 5;
/** Most tips a player gets in an individual question. */
export const INDIVIDUAL_MAX_TIPS = 5;

/** Spaces won for getting an individual question right after a number of tips: 1 -> 10, 2 -> 8 ... 5 -> 2. */
export function individualPoints(tips: number): number {
  return tips >= 1 && tips <= INDIVIDUAL_MAX_TIPS ? 12 - 2 * tips : 0;
}

/** A normal round (one player holds the card, the others guess) or an individual question. */
export type RoundKind = 'normal' | 'individual';
export const DEFAULT_GOAL = 60;
export const MIN_GOAL = 20;
export const MAX_GOAL = 300;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 20;
export const MAX_GUESS_LENGTH = 60;
/** Limits for a card written by a player. */
export const MAX_ANSWER_LENGTH = 60;
export const MAX_TIP_LENGTH = 160;
export const MAX_OWN_ALIASES = 8;

/** A card written by a player: one language, shown as written to everybody. */
export interface OwnCard {
  category: Category;
  answer: string;
  /** Other answers that count as right (optional). */
  aliases?: string[];
  /** Exactly 20 tips. */
  tips: string[];
}

export type Phase = 'lobby' | 'choosing' | 'guessing' | 'roundEnd' | 'finished';

export interface PlayerView {
  id: string;
  name: string;
  position: number;
  connected: boolean;
  /** Colour of the player's token on the board; no two players of a room share one. */
  color: PlayerColor;
}

export interface GuessView {
  id: number;
  playerId: string;
  text: string;
  correct: boolean;
  /** How many tips were on the table when the guess was made. */
  tipsRevealed: number;
}

/** solverLeft: the player of an individual question left the game. */
export type RoundEndReason = 'guessed' | 'noTipsLeft' | 'holderLeft' | 'solverLeft';

/** A special space that acted on a player at the end of a round. */
export interface SpecialEffectView {
  playerId: string;
  kind: SpecialKind;
  /** The special space the player landed on. */
  from: number;
  /** Where the player ended up (the same space for an individual question). */
  to: number;
}

export interface RoundResultView {
  kind: RoundKind;
  reason: RoundEndReason;
  answer: string;
  holderId: string;
  winnerId: string | null;
  tipsUsed: number;
  guesserPoints: number;
  holderPoints: number;
  /** The player who played an individual question (null for a normal round). */
  solverId: string | null;
  /** Special spaces that acted at the end of this round, in the order they acted. */
  effects: SpecialEffectView[];
}

export interface RoundView {
  kind: RoundKind;
  /** Number of the normal round (an individual question keeps the number of the round before it). */
  number: number;
  /** Most tips that can be revealed: 20, or 5 in an individual question. */
  maxTips: number;
  holderId: string;
  /**
   * Player who must pick a tip / guess now. In a normal round, null while nobody who can play is
   * connected; in an individual question, always the player answering (even while away).
   */
  turnId: string | null;
  category: Category;
  /** 20 entries. The card holder sees all of them; the others see null for tips not revealed yet. */
  tips: (string | null)[];
  /** Tip indexes (0-19) in the order they were revealed. */
  revealed: number[];
  guesses: GuessView[];
  /** Only sent to the card holder, or to everyone once the round is over. */
  answer: string | null;
  /** Id of the card, sent like the answer (the browser remembers the cards its player has seen). */
  cardId: string | null;
  /** How many cards the card holder has put aside this round. */
  skipped: number;
  /** Whether the card holder has settled on the card. Until then nobody can pick a tip (and no clock runs). */
  cardChosen: boolean;
  /** True when the card in play was written by the card holder. */
  ownCard: boolean;
  /**
   * The time limit running for the player on turn, if there is one: the whole limit and how
   * much of it was left when this view was made, in milliseconds.
   */
  timer: { limitMs: number; leftMs: number } | null;
  /** Set when the last thing that happened was done by the clock: a random tip, or an automatic pass. */
  timedOut: { playerId: string; action: 'tip' | 'pass' } | null;
}

export interface GameView {
  code: string;
  phase: Phase;
  you: string;
  hostId: string;
  goal: number;
  players: PlayerView[];
  round: RoundView | null;
  result: RoundResultView | null;
  winnerId: string | null;
  /** The options the host chose (in the lobby: for the next game; during a game: for this one). */
  settings: GameSettings;
  /** The special spaces of this game's board (empty before the first game starts). */
  specials: SpecialSpace[];
  /** Players who landed on an individual question and will play it before the next normal round. */
  pendingIndividual: string[];
  /** The cards this player has seen (in this and earlier games); kept by their browser. Emptied once they have seen them all. */
  seenCards: string[];
  /** How many cards the game has. */
  cardCount: number;
}

export interface AckOk<T = unknown> {
  ok: true;
  data: T;
}
export interface AckError {
  ok: false;
  error: { code: string; message: string };
}
export type Ack<T = unknown> = AckOk<T> | AckError;

export interface JoinedData {
  code: string;
  playerId: string;
  /** Secret that lets this browser take its seat back after a reload or a dropped connection. */
  token: string;
}

export interface ClientToServerEvents {
  'room:create': (p: { name: string; locale?: string; seenCards?: string[] }, ack: (r: Ack<JoinedData>) => void) => void;
  'room:join': (
    p: { code: string; name?: string; locale?: string; token?: string; seenCards?: string[] },
    ack: (r: Ack<JoinedData>) => void,
  ) => void;
  'room:leave': (ack: (r: Ack<null>) => void) => void;
  'locale:set': (p: { locale: string }, ack: (r: Ack<null>) => void) => void;
  'player:setColor': (p: { color: string }, ack: (r: Ack<null>) => void) => void;
  'game:configure': (p: Pick<GameSettings, 'goal' | 'specials'> & Partial<GameSettings>, ack: (r: Ack<null>) => void) => void;
  'game:start': (p: { goal?: number }, ack: (r: Ack<null>) => void) => void;
  'game:chooseTip': (p: { index: number }, ack: (r: Ack<null>) => void) => void;
  'game:guess': (p: { text: string }, ack: (r: Ack<{ correct: boolean }>) => void) => void;
  'game:pass': (ack: (r: Ack<null>) => void) => void;
  'game:acceptGuess': (p: { guessId: number }, ack: (r: Ack<null>) => void) => void;
  'game:skipCard': (ack: (r: Ack<null>) => void) => void;
  'game:chooseCard': (ack: (r: Ack<null>) => void) => void;
  'game:useOwnCard': (p: OwnCard, ack: (r: Ack<null>) => void) => void;
  'game:skipIndividual': (ack: (r: Ack<null>) => void) => void;
  'game:nextRound': (ack: (r: Ack<null>) => void) => void;
  'game:playAgain': (ack: (r: Ack<null>) => void) => void;
}

export interface ServerToClientEvents {
  state: (view: GameView) => void;
  /** The player's seat no longer exists (they were away when a new game started). */
  left: () => void;
}
