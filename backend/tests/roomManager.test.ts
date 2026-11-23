import { GameError } from '../src/game/Game';
import { RoomManager } from '../src/game/RoomManager';
import { testCards } from './helpers';

describe('RoomManager', () => {
  it('creates rooms with a 4-letter code and finds them whatever the case', () => {
    const rooms = new RoomManager(testCards);
    const { room, seat } = rooms.create('Ana');
    expect(room.game.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(rooms.get(` ${room.game.code.toLowerCase()} `)).toBe(room);
    expect(seat.token).toHaveLength(48);
    expect(() => rooms.get('NOPE')).toThrow(GameError);
    expect(() => rooms.get(undefined)).toThrow(GameError);
  });

  it('does not keep a room whose creator had no valid name', () => {
    const rooms = new RoomManager(testCards);
    expect(() => rooms.create('')).toThrow(GameError);
    expect(rooms.size).toBe(0);
  });

  it('gives a seat back to whoever holds its token', () => {
    const rooms = new RoomManager(testCards);
    const { room, seat } = rooms.create('Ana');
    const bob = rooms.join(room.game.code, 'Bob').seat;
    expect(rooms.join(room.game.code, 'Whoever', seat.token).seat).toBe(seat);
    expect(rooms.join(room.game.code, undefined, bob.token).seat).toBe(bob);
    // a wrong token is just a new player
    expect(rooms.join(room.game.code, 'Cy', 'bad-token').seat.playerId).not.toBe(seat.playerId);
    expect(room.game.playerCount).toBe(3);
  });

  it('tracks connections per seat (several tabs count as one player)', () => {
    const rooms = new RoomManager(testCards);
    const { room, seat } = rooms.create('Ana');
    rooms.connect(room, seat);
    rooms.connect(room, seat);
    rooms.disconnect(room, seat);
    expect(room.game.connectedCount).toBe(1);
    rooms.disconnect(room, seat);
    expect(room.game.connectedCount).toBe(0);
  });

  it('removes a room when the last player leaves', () => {
    const rooms = new RoomManager(testCards);
    const { room, seat } = rooms.create('Ana');
    rooms.leave(room, seat);
    expect(rooms.size).toBe(0);
  });

  it('sweeps rooms that stayed empty for too long, but not ones somebody came back to', () => {
    let now = 0;
    const rooms = new RoomManager(testCards, { emptyRoomTtlMs: 1000, now: () => now });
    const a = rooms.create('Ana');
    const b = rooms.create('Bob');
    for (const r of [a, b]) {
      rooms.connect(r.room, r.seat);
      rooms.disconnect(r.room, r.seat);
    }
    now = 500;
    rooms.connect(b.room, b.seat);
    now = 1200;
    expect(rooms.sweep()).toBe(1);
    expect(rooms.size).toBe(1);
    expect(rooms.get(b.room.game.code)).toBe(b.room);
  });
});
