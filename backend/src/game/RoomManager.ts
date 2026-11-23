import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Layout } from './board';
import { Game, GameError, Rng } from './Game';
import { Card } from '../types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, easy to read aloud
const CODE_LENGTH = 4;

export interface Seat {
  playerId: string;
  token: string;
  /** How many browser tabs of this player are connected right now. */
  connections: number;
}

export interface Room {
  game: Game;
  seats: Map<string, Seat>; // by playerId
  emptySince: number | null;
}

export interface RoomManagerOptions {
  /** Source of randomness for the games (who starts, order of the cards). */
  rng?: Rng;
  /** Where the special spaces of each game go (random by default). */
  layout?: Layout;
  /** How long a second of the games' time limits lasts, in milliseconds (tests make it shorter). */
  secondMs?: number;
  /** How long a room with nobody connected is kept, in milliseconds. */
  emptyRoomTtlMs?: number;
  now?: () => number;
}

/** Keeps the rooms that exist and who sits where. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private readonly rng: Rng;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly layout?: Layout;
  private readonly secondMs?: number;

  constructor(
    private readonly cards: Card[],
    options: RoomManagerOptions = {},
  ) {
    this.rng = options.rng ?? Math.random;
    this.ttl = options.emptyRoomTtlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.layout = options.layout;
    this.secondMs = options.secondMs;
  }

  get size(): number {
    return this.rooms.size;
  }

  static normalizeCode(code: unknown): string {
    return typeof code === 'string' ? code.trim().toUpperCase() : '';
  }

  get(code: unknown): Room {
    const room = this.rooms.get(RoomManager.normalizeCode(code));
    if (!room) throw new GameError('roomNotFound');
    return room;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private newSeat(room: Room, name: unknown): Seat {
    const seat: Seat = { playerId: randomUUID(), token: randomBytes(24).toString('hex'), connections: 0 };
    room.game.addPlayer(seat.playerId, name);
    room.seats.set(seat.playerId, seat);
    return seat;
  }

  create(hostName: unknown): { room: Room; seat: Seat } {
    const room: Room = { game: new Game(this.newCode(), this.cards, this.rng, { layout: this.layout, secondMs: this.secondMs }), seats: new Map(), emptySince: null };
    const seat = this.newSeat(room, hostName); // throws before the room is stored if the name is bad
    this.rooms.set(room.game.code, room);
    return { room, seat };
  }

  /** Joins as a new player, or takes an existing seat back when a valid token is given. */
  join(code: unknown, name: unknown, token?: unknown): { room: Room; seat: Seat } {
    const room = this.get(code);
    if (typeof token === 'string' && token) {
      const seat = [...room.seats.values()].find((s) => s.token === token);
      if (seat) return { room, seat };
    }
    return { room, seat: this.newSeat(room, name) };
  }

  connect(room: Room, seat: Seat): void {
    seat.connections++;
    room.emptySince = null;
    room.game.setConnected(seat.playerId, true);
  }

  disconnect(room: Room, seat: Seat): void {
    seat.connections = Math.max(0, seat.connections - 1);
    if (seat.connections === 0 && room.game.hasPlayer(seat.playerId)) room.game.setConnected(seat.playerId, false);
    this.markIfEmpty(room);
  }

  leave(room: Room, seat: Seat): void {
    if (room.game.hasPlayer(seat.playerId)) room.game.removePlayer(seat.playerId);
    room.seats.delete(seat.playerId);
    if (room.game.playerCount === 0) this.rooms.delete(room.game.code);
    else this.markIfEmpty(room);
  }

  /** Forgets the seats of players the game itself dropped (people who were away when a game started). */
  pruneSeats(room: Room): string[] {
    const gone = [...room.seats.keys()].filter((id) => !room.game.hasPlayer(id));
    for (const id of gone) room.seats.delete(id);
    return gone;
  }

  private markIfEmpty(room: Room): void {
    if (room.game.connectedCount === 0 && room.emptySince === null) room.emptySince = this.now();
  }

  /** Deletes rooms that have had nobody connected for longer than the time allowed. Returns how many. */
  sweep(): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && this.now() - room.emptySince >= this.ttl) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}
