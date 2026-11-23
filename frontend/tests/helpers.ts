import { defaultScoring, type GameView } from '../src/types';
import type { SocketLike, StorageLike } from '../src/store';

/** A game in progress seen by Bob: Ana holds the card, it is Bob's turn to pick a tip. */
export function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    code: 'ABCD',
    phase: 'choosing',
    you: 'b',
    hostId: 'a',
    goal: 60,
    players: [
      { id: 'a', name: 'Ana', position: 5, connected: true, color: 'red' },
      { id: 'b', name: 'Bob', position: 15, connected: true, color: 'blue' },
      { id: 'c', name: 'Cy', position: 0, connected: false, color: 'green' },
    ],
    round: {
      kind: 'normal',
      maxTips: 20,
      number: 2,
      holderId: 'a',
      turnId: 'b',
      category: 'place',
      tips: Array.from({ length: 20 }, (_, i) => (i === 3 ? 'I am made of iron.' : null)),
      revealed: [3],
      guesses: [{ id: 1, playerId: 'c', text: 'Big Ben', correct: false, tipsRevealed: 1 }],
      answer: null,
      timer: null,
      timedOut: null,
      cardId: null,
      skipped: 0,
      cardChosen: true,
      ownCard: false,
    },
    result: null,
    winnerId: null,
    specials: [
      { index: 7, kind: 'individual' },
      { index: 12, kind: 'back' },
      { index: 20, kind: 'forward' },
      { index: 33, kind: 'dead' },
      { index: 41, kind: 'win' },
    ],
    pendingIndividual: [],
    seenCards: [],
    cardCount: 54,
    settings: { goal: 60, specials: { individual: 3, back: 2, forward: 2, dead: 1, win: 1 }, scoring: defaultScoring(), timers: { tip: 0, guess: 0 }, boardMode: 'random', customBoard: [] },
    ...overrides,
  };
}

/**
 * Bob answers an individual question (after landing on space 7); Ana was drawn to hold the card.
 * Seen by `you`.
 */
export function individualView(you = 'b', revealed: number[] = [3]): GameView {
  const base = makeView({ you, phase: 'choosing' });
  base.players[1].position = 7;
  base.round = {
    ...base.round!,
    kind: 'individual',
    maxTips: 5,
    holderId: 'a',
    turnId: 'b',
    revealed,
    guesses: [],
    tips: Array.from({ length: 20 }, (_, i) => (revealed.includes(i) ? `Tip ${i + 1}` : null)),
  };
  return base;
}

export function lobbyView(you = 'a'): GameView {
  return makeView({ phase: 'lobby', you, round: null, specials: [], players: makeView().players.map((p) => ({ ...p, position: 0 })) });
}

/** Stands in for the socket.io connection: records what is sent and lets a test answer it. */
export class FakeSocket implements SocketLike {
  connected = true;
  sent: { event: string; payload?: any; reply: (r: unknown) => void }[] = [];
  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: any[]) {
    const reply = args.pop();
    this.sent.push({ event, payload: args[0], reply });
    return this;
  }

  /** Pretends the server sent something. */
  receive(event: string, ...args: unknown[]) {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }

  last() {
    return this.sent[this.sent.length - 1];
  }
}

export class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
