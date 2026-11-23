import { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { io as connect, Socket } from 'socket.io-client';
import { createGameServer } from '../src/server';
import { Ack, ClientToServerEvents, defaultScoring, GameView, JoinedData, ServerToClientEvents } from '../src/types';
import { noSpecials, testCards, zero } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { last?: GameView };

let server: ReturnType<typeof createGameServer>;
let url: string;
let staticDir: string;
const clients: Client[] = [];

beforeAll((done) => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
  server = createGameServer({ cards: testCards, rng: zero, staticDir, layout: noSpecials, secondMs: 10 });
  server.httpServer.listen(0, () => {
    url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
    done();
  });
});

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

afterAll(async () => {
  await server.close();
  fs.rmSync(staticDir, { recursive: true });
});

function client(locale = 'en'): Promise<Client> {
  return new Promise((resolve) => {
    const c: Client = connect(url, { auth: { locale }, transports: ['websocket'], forceNew: true });
    clients.push(c);
    c.on('state', (view) => (c.last = view));
    c.on('connect', () => resolve(c));
  });
}

/** Emits an event and resolves with the server's reply. */
function call<T = unknown>(c: Client, event: string, payload?: object): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const emit = c.emit.bind(c) as (...args: unknown[]) => void;
    if (payload === undefined) emit(event, resolve);
    else emit(event, payload, resolve);
  });
}

/** Waits until the client's latest state satisfies the condition. */
async function until(c: Client, cond: (v: GameView) => boolean): Promise<GameView> {
  for (let i = 0; i < 200; i++) {
    if (c.last && cond(c.last)) return c.last;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`state never arrived; last: ${JSON.stringify(c.last)}`);
}

async function roomOfTwo() {
  const ana = await client('en');
  const bob = await client('pt-BR');
  const created = await call<JoinedData>(ana, 'room:create', { name: 'Ana' });
  if (!created.ok) throw new Error('create failed');
  const joined = await call<JoinedData>(bob, 'room:join', { code: created.data.code, name: 'Bob' });
  if (!joined.ok) throw new Error('join failed');
  await until(ana, (v) => v.players.length === 2);
  return { ana, bob, code: created.data.code, anaSeat: created.data, bobSeat: joined.data };
}

describe('http', () => {
  it('reports health and card counts', async () => {
    const health = await request(server.app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    const stats = await request(server.app).get('/api/cards/stats');
    expect(stats.body).toEqual({ total: 3, byCategory: { thing: 1, person: 1, place: 1, year: 0 } });
  });

  it('serves the built frontend, also for addresses inside the app', async () => {
    expect((await request(server.app).get('/')).text).toContain('<title>app</title>');
    expect((await request(server.app).get('/room/ABCD')).text).toContain('<title>app</title>');
    expect((await request(server.app).get('/api/nothing')).status).toBe(404);
  });
});

describe('sockets', () => {
  it('creates and joins a room, and tells everybody', async () => {
    const { ana, bob, code } = await roomOfTwo();
    expect(code).toMatch(/^[A-Z]{4}$/);
    const v = await until(bob, (s) => s.players.length === 2);
    expect(v.players.map((p) => p.name)).toEqual(['Ana', 'Bob']);
    expect(v.phase).toBe('lobby');
    expect(v.you).not.toBe(ana.last!.you);
    expect(v.hostId).toBe(ana.last!.you);
  });

  it('refuses in the language of the player', async () => {
    const { ana, bob, code } = await roomOfTwo();
    const stranger = await client('pt-BR');
    expect(await call(stranger, 'room:join', { code: 'ZZZZ', name: 'X' })).toEqual({
      ok: false,
      error: { code: 'roomNotFound', message: 'Não existe sala com esse código.' },
    });
    expect(await call(stranger, 'room:join', { code, name: 'ana' })).toMatchObject({ error: { code: 'nameTaken' } });
    expect(await call(stranger, 'game:start', {})).toMatchObject({ error: { code: 'notInRoom' } });
    expect(await call(bob, 'game:start', {})).toMatchObject({ error: { code: 'onlyHost', message: 'Só o anfitrião pode fazer isso.' } });
    expect(await call(ana, 'room:create', { name: 'Again' })).toMatchObject({ error: { code: 'alreadyInRoom' } });
    expect(await call(ana, 'game:chooseTip', 'nonsense' as unknown as object)).toMatchObject({ error: { code: 'badRequest' } });
  });

  it('lets players pick different token colours', async () => {
    const { ana, bob } = await roomOfTwo();
    expect(ana.last!.players.map((p) => p.color)).toEqual(['red', 'orange']);
    expect(await call(bob, 'player:setColor', { color: 'purple' })).toEqual({ ok: true, data: null });
    expect((await until(ana, (v) => v.players[1].color === 'purple')).players[0].color).toBe('red');
    expect(await call(ana, 'player:setColor', { color: 'purple' })).toEqual({
      ok: false,
      error: { code: 'colorTaken', message: 'Another player already has that color.' },
    });
    expect(await call(bob, 'player:setColor', { color: 'red' })).toMatchObject({
      error: { code: 'colorTaken', message: 'Outro jogador já está com essa cor.' },
    });
    await call(ana, 'game:start', {});
    await until(bob, (v) => v.phase === 'choosing');
    expect(await call(bob, 'player:setColor', { color: 'green' })).toMatchObject({ error: { code: 'colorLocked' } });
  });

  it('plays a round: secret kept from guessers, tips in each language, points awarded', async () => {
    const { ana, bob } = await roomOfTwo();
    expect(await call(ana, 'game:start', { goal: 30 })).toEqual({ ok: true, data: null });
    const holderView = await until(ana, (v) => v.phase === 'choosing');
    const guesserView = await until(bob, (v) => v.phase === 'choosing');
    // with the fixed random source Ana holds the card
    expect(holderView.round!.holderId).toBe(holderView.you);
    expect(holderView.round!.answer).toMatch(/^Answer \d$/);
    expect(guesserView.round!.answer).toBeNull();
    expect(JSON.stringify(guesserView)).not.toMatch(/Resposta|Answer|dica|tip \d/);

    // nobody picks a tip before the card holder has chosen the card
    expect(await call(bob, 'game:chooseTip', { index: 3 })).toMatchObject({ error: { code: 'cardNotChosen', message: 'Espere quem está com a carta escolher a carta.' } });
    expect(await call(bob, 'game:chooseCard')).toMatchObject({ error: { code: 'onlyHolder' } });
    expect(await call(ana, 'game:chooseCard')).toEqual({ ok: true, data: null });
    expect((await until(bob, (v) => v.round!.cardChosen)).round!.cardChosen).toBe(true);
    expect(await call(ana, 'game:skipCard')).toMatchObject({ error: { code: 'tooLateToSkip' } });
    expect(await call(ana, 'game:chooseTip', { index: 3 })).toMatchObject({ error: { code: 'notYourTurn' } });
    expect(await call(bob, 'game:chooseTip', { index: 3 })).toEqual({ ok: true, data: null });
    const afterTip = await until(bob, (v) => v.phase === 'guessing');
    expect(afterTip.round!.tips[3]).toMatch(/^Carta \d dica 4$/);
    expect((await until(ana, (v) => v.phase === 'guessing')).round!.tips[3]).toMatch(/^Card \d tip 4$/);

    expect(await call(bob, 'game:guess', { text: 'errado' })).toEqual({ ok: true, data: { correct: false } });
    await until(bob, (v) => v.phase === 'choosing' && v.round!.guesses.length === 1);
    await call(bob, 'game:chooseTip', { index: 0 });
    const answer = holderView.round!.answer!.replace('Answer', 'Resposta'); // Bob answers in Portuguese
    expect(await call(bob, 'game:guess', { text: answer })).toEqual({ ok: true, data: { correct: true } });

    const end = await until(ana, (v) => v.phase === 'roundEnd');
    expect(end.result).toMatchObject({ reason: 'guessed', winnerId: bob.last!.you, tipsUsed: 2, guesserPoints: 18, holderPoints: 2 });
    expect(end.players.map((p) => p.position)).toEqual([2, 18]);
    expect((await until(bob, (v) => v.phase === 'roundEnd')).result!.answer).toBe(answer);

    expect(await call(ana, 'game:nextRound')).toEqual({ ok: true, data: null });
    const next = await until(ana, (v) => v.phase === 'choosing' && v.round!.number === 2);
    expect(next.round!.holderId).toBe(bob.last!.you);
    expect(next.round!.answer).toBeNull();
  });

  it('lets the host set the game options, which everybody sees', async () => {
    const { ana, bob } = await roomOfTwo();
    const settings = { goal: 30, specials: { individual: 2, back: 0, forward: 1, dead: 0, win: 1 } };
    expect(await call(bob, 'game:configure', settings)).toMatchObject({ error: { code: 'onlyHost' } });
    expect(await call(ana, 'game:configure', settings)).toEqual({ ok: true, data: null });
    expect((await until(bob, (v) => v.settings.goal === 30)).settings).toEqual({ ...settings, scoring: defaultScoring(), timers: { tip: 0, guess: 0 }, boardMode: 'random', customBoard: [] });
    expect(await call(ana, 'game:configure', { goal: 20, specials: { individual: 19, back: 0, forward: 0, dead: 0, win: 1 } })).toEqual({
      ok: false,
      error: { code: 'tooManySpecials', message: 'There are more special spaces than spaces on the board.' },
    });
  });

  it('plays for players who run out of time: a random tip, then an automatic pass', async () => {
    const { ana, bob } = await roomOfTwo();
    const specials = { individual: 0, back: 0, forward: 0, dead: 0, win: 0 };
    // in this test server a "second" lasts 10 ms: 15 s -> 150 ms
    expect(await call(ana, 'game:configure', { goal: 60, specials, timers: { tip: 15, guess: 15 } })).toEqual({ ok: true, data: null });
    await call(ana, 'game:start', {});
    const waiting = await until(bob, (v) => v.phase === 'choosing');
    expect(waiting.round!.timer).toBeNull(); // no clock until the card is chosen
    await call(ana, 'game:chooseCard');
    const first = await until(bob, (v) => v.round!.timer !== null);
    expect(first.round!.timer!.limitMs).toBe(150);
    expect(first.round!.timer!.leftMs).toBeGreaterThan(0);
    // Bob does nothing: a tip appears by itself...
    const tipped = await until(bob, (v) => v.phase === 'guessing');
    expect(tipped.round!.revealed).toHaveLength(1);
    expect(tipped.round!.timedOut).toEqual({ playerId: bob.last!.you, action: 'tip' });
    // ...and then his turn to guess passes by itself
    const passed = await until(ana, (v) => v.phase === 'choosing' && v.round!.revealed.length === 1);
    expect(passed.round!.timedOut).toEqual({ playerId: bob.last!.you, action: 'pass' });
    expect(passed.round!.guesses).toEqual([]);
    // a player who acts in time is left alone
    await until(bob, (v) => v.phase === 'guessing' && v.round!.revealed.length === 2);
    expect(await call(bob, 'game:guess', { text: 'wrong' })).toEqual({ ok: true, data: { correct: false } });
    expect((await until(ana, (v) => v.round!.guesses.length === 1)).round!.timedOut).toBeNull();
  });

  it('refuses to skip an individual question when none is being played', async () => {
    const { ana } = await roomOfTwo();
    await call(ana, 'game:start', {});
    expect(await call(ana, 'game:skipIndividual')).toMatchObject({ error: { code: 'noIndividual', message: 'No individual question is being played.' } });
  });

  it('does not draw cards a player has seen before, and lets the card holder skip one', async () => {
    const ana = await client('en');
    const bob = await client('en');
    const created = await call<JoinedData>(ana, 'room:create', { name: 'Ana', seenCards: ['thing-test-1'] });
    if (!created.ok) throw new Error('create failed');
    await call(bob, 'room:join', { code: created.data.code, name: 'Bob', seenCards: ['place-test-2', 'not-a-card'] });
    await until(ana, (v) => v.players.length === 2);
    expect(ana.last!.seenCards).toEqual(['thing-test-1']);
    await call(ana, 'game:start', {});
    const v = await until(ana, (s) => s.phase === 'choosing');
    expect(v.round!.cardId).toBe('person-test-3'); // the only card neither has seen
    expect(await call(bob, 'game:skipCard')).toMatchObject({ error: { code: 'onlyHolder' } });
    expect(await call(ana, 'game:skipCard')).toEqual({ ok: true, data: null });
    const skipped = await until(bob, (s) => s.round?.skipped === 1);
    expect(skipped.round!.cardId).toBeNull();
  });

  it('lets the card holder play a card of their own', async () => {
    const { ana, bob } = await roomOfTwo();
    await call(ana, 'game:start', {});
    await until(bob, (v) => v.phase === 'choosing');
    const card = { category: 'thing', answer: 'Teapot', tips: Array.from({ length: 20 }, (_, i) => `Teapot tip ${i + 1}`) };
    expect(await call(bob, 'game:useOwnCard', card)).toMatchObject({ error: { code: 'onlyHolder' } });
    expect(await call(ana, 'game:useOwnCard', { ...card, tips: [] })).toEqual({
      ok: false,
      error: { code: 'invalidCard', message: 'That card cannot be used: it needs a category, an answer and all 20 tips.' },
    });
    expect(await call(ana, 'game:useOwnCard', card)).toEqual({ ok: true, data: null });
    const v = await until(bob, (s) => s.round!.cardChosen);
    expect(v.round).toMatchObject({ ownCard: true, answer: null });
    expect(JSON.stringify(v)).not.toContain('Teapot');
    await call(bob, 'game:chooseTip', { index: 2 });
    expect((await until(bob, (s) => s.phase === 'guessing')).round!.tips[2]).toBe('Teapot tip 3');
    expect(await call(bob, 'game:guess', { text: 'teapot' })).toEqual({ ok: true, data: { correct: true } });
  });

  it('lets the card holder accept a guess', async () => {
    const { ana, bob } = await roomOfTwo();
    await call(ana, 'game:start', {});
    await until(bob, (v) => v.phase === 'choosing');
    await call(ana, 'game:chooseCard');
    await call(bob, 'game:chooseTip', { index: 0 });
    await call(bob, 'game:guess', { text: 'almost' });
    const v = await until(ana, (s) => s.round!.guesses.length === 1);
    expect(await call(bob, 'game:acceptGuess', { guessId: v.round!.guesses[0].id })).toMatchObject({ error: { code: 'onlyHolder' } });
    expect(await call(ana, 'game:acceptGuess', { guessId: v.round!.guesses[0].id })).toEqual({ ok: true, data: null });
    expect((await until(bob, (s) => s.phase === 'roundEnd')).result).toMatchObject({ winnerId: bob.last!.you, guesserPoints: 19 });
  });

  it('switches the language of the cards on request', async () => {
    const { ana, bob } = await roomOfTwo();
    await call(ana, 'game:start', {});
    await until(bob, (v) => v.phase === 'choosing');
    await call(ana, 'game:chooseCard');
    await call(bob, 'game:chooseTip', { index: 0 });
    await until(bob, (v) => /^Carta/.test(v.round?.tips[0] ?? ''));
    expect(await call(bob, 'locale:set', { locale: 'en' })).toEqual({ ok: true, data: null });
    await until(bob, (v) => /^Card/.test(v.round?.tips[0] ?? ''));
  });

  it('keeps the seat of a player whose connection drops, and gives it back with the token', async () => {
    const { ana, bob, code, bobSeat } = await roomOfTwo();
    await call(ana, 'game:start', {});
    await until(bob, (v) => v.phase === 'choosing');
    bob.disconnect();
    const away = await until(ana, (v) => v.players[1].connected === false);
    expect(away.round!.turnId).toBe(bobSeat.playerId); // the round waits for him

    const bobAgain = await client('en');
    const back = await call<JoinedData>(bobAgain, 'room:join', { code, token: bobSeat.token });
    expect(back).toMatchObject({ ok: true, data: { playerId: bobSeat.playerId } });
    const resumed = await until(ana, (v) => v.players[1].connected === true);
    expect(resumed.players).toHaveLength(2);
    expect(resumed.round!.turnId).toBe(bobSeat.playerId);
    expect((await until(bobAgain, (v) => v.phase === 'choosing')).you).toBe(bobSeat.playerId);

    // a newcomer without a token cannot get into a game that has started
    const late = await client();
    expect(await call(late, 'room:join', { code, name: 'Late' })).toMatchObject({ error: { code: 'gameAlreadyStarted' } });
  });

  it('removes a player who leaves and deletes the room after the last one', async () => {
    const { ana, bob, code } = await roomOfTwo();
    expect(await call(bob, 'room:leave')).toEqual({ ok: true, data: null });
    const v = await until(ana, (s) => s.players.length === 1);
    expect(v.players[0].name).toBe('Ana');
    await call(ana, 'room:leave');
    expect(() => server.rooms.get(code)).toThrow();
    // and the socket is free to create another room
    expect(await call(ana, 'room:create', { name: 'Ana' })).toMatchObject({ ok: true });
  });
});
