import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, Socket } from 'socket.io';
import { loadCards } from './cards';
import { configFromEnv, generateCard, GeneratorConfig, isCategory } from './cardGenerator';
import { Layout } from './game/board';
import { GameError, Rng } from './game/Game';
import { Room, RoomManager, Seat } from './game/RoomManager';
import { resolveLocale, translateError } from './i18n';
import { Ack, Card, CATEGORIES, ClientToServerEvents, Locale, ServerToClientEvents } from './types';

interface SocketData {
  locale: Locale;
  room?: Room;
  seat?: Seat;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface ServerOptions {
  cards?: Card[];
  rng?: Rng;
  /** Where the special spaces go (random by default; tests fix them). */
  layout?: Layout;
  /** How long a second of the time limits lasts, in milliseconds (tests make it shorter). */
  secondMs?: number;
  /** The AI service that writes cards (by default read from the environment; null turns the feature off). */
  generator?: { config: GeneratorConfig | null; fetch?: (url: string, init: RequestInit) => Promise<Response> };
  /** How many cards one address may ask for per minute. */
  generateLimitPerMinute?: number;
  /**
   * How many proxies stand in front of the server (1 on Render and most hosting platforms), so
   * that it sees each visitor's own address rather than the proxy's. Leave unset without a proxy.
   */
  trustProxy?: number | boolean;
  /** Folder with the built frontend; served when it exists. */
  staticDir?: string;
  /** Origins allowed to connect from another address (only needed while developing). */
  corsOrigin?: string | string[] | boolean;
  emptyRoomTtlMs?: number;
}

export function createGameServer(options: ServerOptions = {}) {
  const cards = options.cards ?? loadCards();
  const rooms = new RoomManager(cards, { rng: options.rng, layout: options.layout, secondMs: options.secondMs, emptyRoomTtlMs: options.emptyRoomTtlMs });

  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', options.trustProxy);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: rooms.size });
  });

  // ---- writing a card with an AI service
  const generator = options.generator ?? { config: configFromEnv(process.env) };
  const limit = options.generateLimitPerMinute ?? 5;
  const recent = new Map<string, number[]>(); // address -> times of its last requests

  app.get('/api/cards/generate', (_req, res) => {
    res.json({ available: generator.config !== null });
  });

  app.post('/api/cards/generate', express.json({ limit: '4kb' }), async (req, res) => {
    const body = (req.body ?? {}) as { category?: unknown; answer?: unknown; locale?: unknown };
    if (!isCategory(body.category) || (body.answer !== undefined && typeof body.answer !== 'string')) {
      res.status(400).json({ ok: false, error: { code: 'badRequest' } });
      return;
    }
    if (!generator.config) {
      res.status(503).json({ ok: false, error: { code: 'notConfigured' } });
      return;
    }
    const now = Date.now();
    const who = req.ip ?? 'unknown';
    const times = (recent.get(who) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= limit) {
      res.status(429).json({ ok: false, error: { code: 'rateLimited' } });
      return;
    }
    recent.set(who, [...times, now]);
    const result = await generateCard(
      { category: body.category, answer: (body.answer as string | undefined)?.slice(0, 60), locale: resolveLocale(body.locale) },
      generator.config,
      generator.fetch,
    );
    if (result.ok) {
      res.json({ ok: true, card: result.card, complete: result.complete });
      return;
    }
    console.warn(`card generator: ${result.code}${result.detail ? ` (${result.detail})` : ''}`);
    const status = result.code === 'providerBusy' ? 429 : result.code === 'notConfigured' ? 503 : 502;
    res.status(status).json({ ok: false, error: { code: result.code } });
  });

  app.get('/api/cards/stats', (_req, res) => {
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, cards.filter((x) => x.category === c).length]));
    res.json({ total: cards.length, byCategory });
  });

  const staticDir = options.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    // Any other address that is not part of the API gets the app (it is a single-page app).
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: options.corsOrigin ? { origin: options.corsOrigin } : undefined,
  });

  const channel = (room: Room) => `room:${room.game.code}`;

  /** One clock per room with a time limit running: it acts for the player on turn when their time is up. */
  const clocks = new Map<Room, NodeJS.Timeout>();

  function setClock(room: Room): void {
    clearTimeout(clocks.get(room));
    clocks.delete(room);
    const deadline = room.game.deadline;
    if (deadline === null) return;
    const clock = setTimeout(() => {
      clocks.delete(room);
      try {
        room.game.expire();
      } catch (err) {
        console.error(err);
      }
      void broadcast(room); // also sets the clock for the next turn
    }, Math.max(0, deadline - Date.now()) + 5);
    clock.unref();
    clocks.set(room, clock);
  }

  /** Sends every connected player of a room their own view of the game. */
  async function broadcast(room: Room): Promise<void> {
    setClock(room);
    const gone = rooms.pruneSeats(room);
    const sockets = (await io.in(channel(room)).fetchSockets()) as unknown as GameSocket[];
    for (const s of sockets) {
      const seat = s.data.seat;
      if (!seat) continue;
      if (gone.includes(seat.playerId) || !room.game.hasPlayer(seat.playerId)) {
        s.leave(channel(room));
        s.data.room = undefined;
        s.data.seat = undefined;
        s.emit('left');
        continue;
      }
      s.emit('state', room.game.viewFor(seat.playerId, s.data.locale));
    }
  }

  function fail(socket: GameSocket, err: unknown): Ack<never> {
    const code = err instanceof GameError ? err.code : 'internal';
    if (!(err instanceof GameError)) console.error(err);
    return { ok: false, error: { code, message: translateError(code, socket.data.locale) } };
  }

  /** Wraps a handler: checks the shape of the call, turns rule violations into a translated refusal. */
  function handle<P, T>(socket: GameSocket, hasPayload: boolean, fn: (payload: P) => T) {
    return (...args: unknown[]) => {
      const ack = args[hasPayload ? 1 : 0];
      const reply = typeof ack === 'function' ? (ack as (r: Ack<T>) => void) : () => undefined;
      try {
        const payload = (hasPayload ? args[0] : undefined) as P;
        if (hasPayload && (payload === null || typeof payload !== 'object')) throw new GameError('badRequest');
        reply({ ok: true, data: fn(payload) });
      } catch (err) {
        reply(fail(socket, err));
      }
    };
  }

  function seated(socket: GameSocket): { room: Room; seat: Seat } {
    const { room, seat } = socket.data;
    if (!room || !seat || !room.game.hasPlayer(seat.playerId)) throw new GameError('notInRoom');
    return { room, seat };
  }

  function sit(socket: GameSocket, room: Room, seat: Seat) {
    socket.data.room = room;
    socket.data.seat = seat;
    socket.join(channel(room));
    rooms.connect(room, seat);
    void broadcast(room);
    return { code: room.game.code, playerId: seat.playerId, token: seat.token };
  }

  function unsit(socket: GameSocket, forGood: boolean): void {
    const { room, seat } = socket.data;
    if (!room || !seat) return;
    socket.data.room = undefined;
    socket.data.seat = undefined;
    socket.leave(channel(room));
    if (forGood) rooms.leave(room, seat);
    else rooms.disconnect(room, seat);
    void broadcast(room);
  }

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as GameSocket;
    socket.data.locale = resolveLocale(socket.handshake.auth?.locale ?? socket.handshake.headers['accept-language']);

    const setLocale = (value: unknown) => {
      if (typeof value === 'string' && value) socket.data.locale = resolveLocale(value);
    };

    socket.on(
      'room:create',
      handle(socket, true, (p: { name: string; locale?: string; seenCards?: string[] }) => {
        setLocale(p.locale);
        if (socket.data.room) throw new GameError('alreadyInRoom');
        const { room, seat } = rooms.create(p.name);
        room.game.rememberCards(seat.playerId, p.seenCards);
        return sit(socket, room, seat);
      }),
    );

    socket.on(
      'room:join',
      handle(socket, true, (p: { code: string; name?: string; locale?: string; token?: string; seenCards?: string[] }) => {
        setLocale(p.locale);
        if (socket.data.room) throw new GameError('alreadyInRoom');
        const { room, seat } = rooms.join(p.code, p.name, p.token);
        room.game.rememberCards(seat.playerId, p.seenCards);
        return sit(socket, room, seat);
      }),
    );

    socket.on(
      'room:leave',
      handle(socket, false, () => {
        unsit(socket, true);
        return null;
      }),
    );

    socket.on(
      'locale:set',
      handle(socket, true, (p: { locale: string }) => {
        setLocale(p.locale);
        const { room, seat } = socket.data;
        if (room && seat && room.game.hasPlayer(seat.playerId)) {
          socket.emit('state', room.game.viewFor(seat.playerId, socket.data.locale));
        }
        return null;
      }),
    );

    /** An action on the game by the player on this socket; everybody gets the new state afterwards. */
    const action = <P, T>(hasPayload: boolean, fn: (room: Room, playerId: string, payload: P) => T) =>
      handle(socket, hasPayload, (payload: P) => {
        const { room, seat } = seated(socket);
        const result = fn(room, seat.playerId, payload);
        void broadcast(room);
        return result;
      });

    socket.on('player:setColor', action(true, (room, id, p: { color: string }) => (room.game.setColor(id, p.color), null)));
    socket.on('game:configure', action(true, (room, id, p: unknown) => (room.game.configure(id, p), null)));
    socket.on('game:start', action(true, (room, id, p: { goal?: number }) => (room.game.start(id, p.goal), null)));
    socket.on('game:chooseTip', action(true, (room, id, p: { index: number }) => (room.game.chooseTip(id, p.index), null)));
    socket.on('game:guess', action(true, (room, id, p: { text: string }) => ({ correct: room.game.guess(id, p.text) })));
    socket.on('game:pass', action(false, (room, id) => (room.game.pass(id), null)));
    socket.on('game:acceptGuess', action(true, (room, id, p: { guessId: number }) => (room.game.acceptGuess(id, p.guessId), null)));
    socket.on('game:chooseCard', action(false, (room, id) => (room.game.chooseCard(id), null)));
    socket.on('game:useOwnCard', action(true, (room, id, p: unknown) => (room.game.useOwnCard(id, p), null)));
    socket.on('game:skipCard', action(false, (room, id) => (room.game.skipCard(id), null)));
    socket.on('game:skipIndividual', action(false, (room, id) => (room.game.skipIndividual(id), null)));
    socket.on('game:nextRound', action(false, (room, id) => (room.game.nextRound(id), null)));
    socket.on('game:playAgain', action(false, (room, id) => (room.game.playAgain(id), null)));

    socket.on('disconnect', () => unsit(socket, false));
  });

  const sweeper = setInterval(() => rooms.sweep(), 60 * 1000);
  sweeper.unref();

  async function close(): Promise<void> {
    clearInterval(sweeper);
    for (const clock of clocks.values()) clearTimeout(clock);
    clocks.clear();
    await io.close();
  }

  return { app, httpServer, io, rooms, close };
}
