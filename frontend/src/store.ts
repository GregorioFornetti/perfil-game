import { reactive } from 'vue';
import type { Ack, GameSettings, GameView, JoinedData, OwnCard } from './types';

/** The part of a socket.io client socket the store uses (so tests can pass a fake one). */
export interface SocketLike {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Session {
  code: string;
  token: string;
}

export interface StoreState {
  connected: boolean;
  /** True while we are trying to take our seat back after a reload. */
  restoring: boolean;
  view: GameView | null;
  /** A message to show the player: either text from the server or a translation key. */
  error: { text?: string; key?: string } | null;
}

export const SESSION_KEY = 'twenty-tips.session';
export const NAME_KEY = 'twenty-tips.name';
/** The cards this browser's player has already seen, so that the server does not draw them again. */
export const SEEN_KEY = 'twenty-tips.seen-cards';

export function readSeenCards(storage: StorageLike): string[] {
  try {
    const list = JSON.parse(storage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function readSession(storage: StorageLike): Session | null {
  try {
    const s = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null');
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function createStore(socket: SocketLike, storage: StorageLike, getLocale: () => string, replyTimeoutMs = 8000) {
  const state = reactive<StoreState>({
    connected: socket.connected,
    restoring: false,
    view: null,
    error: null,
  });

  /** Sends an action to the server and waits for its answer. A refusal is shown to the player. */
  function send<T>(event: string, payload?: object, quiet = false): Promise<Ack<T>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reply: Ack<T>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!reply.ok && !quiet) {
          state.error = reply.error.code === 'noReply' ? { key: 'connection.noReply' } : { text: reply.error.message };
        }
        resolve(reply);
      };
      const timer = setTimeout(() => finish({ ok: false, error: { code: 'noReply', message: '' } }), replyTimeoutMs);
      if (payload === undefined) socket.emit(event, finish);
      else socket.emit(event, payload, finish);
    });
  }

  function forget() {
    storage.removeItem(SESSION_KEY);
    state.view = null;
  }

  async function enter(event: 'room:create' | 'room:join', payload: object, quiet = false): Promise<boolean> {
    const reply = await send<JoinedData>(event, { ...payload, locale: getLocale(), seenCards: readSeenCards(storage) }, quiet);
    if (reply.ok) {
      storage.setItem(SESSION_KEY, JSON.stringify({ code: reply.data.code, token: reply.data.token }));
      state.error = null;
    }
    return reply.ok;
  }

  /** After a reload or a dropped connection: sit back down in the room we were in. */
  async function restore() {
    const session = readSession(storage);
    if (!session) return;
    state.restoring = true;
    const ok = await enter('room:join', { code: session.code, token: session.token, name: storage.getItem(NAME_KEY) ?? '' }, true);
    state.restoring = false;
    // Keep the session if the server just did not answer; drop it if the room is gone.
    if (!ok && socket.connected) forget();
  }

  socket.on('connect', () => {
    state.connected = true;
    void restore();
  });
  socket.on('disconnect', () => {
    state.connected = false;
  });
  socket.on('state', (view: GameView) => {
    state.view = view;
    // the server keeps the list up to date (and empties it once every card has been seen)
    if (Array.isArray(view.seenCards)) storage.setItem(SEEN_KEY, JSON.stringify(view.seenCards));
  });
  socket.on('left', forget);
  if (socket.connected) void restore();

  return {
    state,
    clearError() {
      state.error = null;
    },
    createRoom(name: string) {
      storage.setItem(NAME_KEY, name);
      return enter('room:create', { name });
    },
    joinRoom(code: string, name: string) {
      storage.setItem(NAME_KEY, name);
      return enter('room:join', { code, name });
    },
    async leave() {
      await send('room:leave');
      forget();
    },
    setLocale(locale: string) {
      return send('locale:set', { locale }, true);
    },
    setColor: (color: string) => send('player:setColor', { color }),
    configure: (settings: GameSettings) => send('game:configure', settings),
    start: () => send('game:start', {}),
    chooseTip: (index: number) => send('game:chooseTip', { index }),
    guess: (text: string) => send<{ correct: boolean }>('game:guess', { text }),
    pass: () => send('game:pass'),
    acceptGuess: (guessId: number) => send('game:acceptGuess', { guessId }),
    nextRound: () => send('game:nextRound'),
    skipIndividual: () => send('game:skipIndividual'),
    skipCard: () => send('game:skipCard'),
    chooseCard: () => send('game:chooseCard'),
    useOwnCard: (card: OwnCard) => send('game:useOwnCard', card),
    playAgain: () => send('game:playAgain'),
  };
}

export type GameStore = ReturnType<typeof createStore>;
