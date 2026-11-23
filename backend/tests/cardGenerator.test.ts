import request from 'supertest';
import { buildMessages, configFromEnv, DEFAULT_BASE_URL, DEFAULT_MODEL, extractJson, generateCard, GeneratorConfig, parseCard } from '../src/cardGenerator';
import { createGameServer } from '../src/server';
import { noSpecials, testCards } from './helpers';

// Every test here talks to a pretend AI service: no network is used.

const config: GeneratorConfig = { apiKey: 'test-key', baseUrl: 'https://llm.example/v1', model: 'test-model', jsonMode: true, timeoutMs: 200 };

const tips = (n: number, word = 'Tip') => Array.from({ length: n }, (_, i) => `${word} number ${i + 1} about me.`);
const goodCard = { answer: 'Eiffel Tower', aliases: ['Tour Eiffel', 'eiffel tower', ''], tips: tips(20) };

/** What the service sends back: an OpenAI-style chat completion holding `content`. */
const completion = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A pretend service answering with the given replies in turn, remembering what it was asked. */
function fakeService(...replies: (Response | Error | (() => Promise<Response>))[]) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply();
    return reply.clone();
  };
  return { fetchImpl, calls };
}

describe('settings', () => {
  it('are off without a key, and have sensible defaults', () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ LLM_API_KEY: '   ' })).toBeNull();
    expect(configFromEnv({ LLM_API_KEY: 'gsk_x' })).toEqual({ apiKey: 'gsk_x', baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, jsonMode: true, timeoutMs: 30000 });
    expect(
      configFromEnv({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://openrouter.ai/api/v1/', LLM_MODEL: 'm:free', LLM_JSON_MODE: 'FALSE', LLM_TIMEOUT_MS: '5000' }),
    ).toEqual({ apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', model: 'm:free', jsonMode: false, timeoutMs: 5000 });
  });
});

describe('what is asked', () => {
  it('names the category, the language, and the answer when the player gave one', () => {
    const pt = buildMessages({ category: 'year', answer: ' 1969 ', locale: 'pt-BR' });
    expect(pt[0].content).toContain('Brazilian Portuguese');
    expect(pt[0].content).toContain('Neste ano');
    expect(pt[0].content).toContain('exactly 20');
    expect(pt[1].content).toContain('"1969"');
    const en = buildMessages({ category: 'person', locale: 'en' });
    expect(en[0].content).toContain('English');
    expect(en[1].content).toContain('Choose a well-known answer yourself');
  });

  it('sends the key, the model and the request for JSON to the service', async () => {
    const { fetchImpl, calls } = fakeService(completion(JSON.stringify(goodCard)));
    await generateCard({ category: 'place', locale: 'en' }, config, fetchImpl);
    expect(calls[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer test-key');
    expect(calls[0].body).toMatchObject({ model: 'test-model', response_format: { type: 'json_object' } });
    const { fetchImpl: plainFetch, calls: plainCalls } = fakeService(completion(JSON.stringify(goodCard)));
    await generateCard({ category: 'place', locale: 'en' }, { ...config, jsonMode: false }, plainFetch);
    expect(plainCalls[0].body.response_format).toBeUndefined();
  });
});

describe('reading what the model wrote', () => {
  it('takes a well-formed card as it is', () => {
    expect(parseCard(JSON.stringify(goodCard))).toEqual({
      ok: true,
      complete: true,
      card: { answer: 'Eiffel Tower', aliases: ['Tour Eiffel'], tips: tips(20) },
    });
  });

  it('finds the card inside prose, code fences, or a list holding it', () => {
    expect(parseCard(JSON.stringify([goodCard]))).toMatchObject({ ok: true });
    const reply = 'Sure! Here is your card:\n```json\n' + JSON.stringify(goodCard, null, 2) + '\n```\nHave fun!';
    expect(parseCard(reply)).toMatchObject({ ok: true, complete: true });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });

  it('removes numbering and bullets in front of tips, and spaces', () => {
    const numbered = { ...goodCard, tips: tips(20).map((t, i) => [`${i + 1}. ${t}`, `- ${t}`, `Tip ${i + 1}: ${t}`, `  ${t}  `][i % 4]) };
    const parsed = parseCard(JSON.stringify(numbered));
    expect(parsed.ok && parsed.card.tips).toEqual(tips(20));
  });

  it('keeps only 20 tips when there are more', () => {
    const parsed = parseCard(JSON.stringify({ ...goodCard, tips: tips(27) }));
    expect(parsed).toMatchObject({ ok: true, complete: true });
    expect(parsed.ok && parsed.card.tips).toHaveLength(20);
  });

  it('drops tips that give the answer away, repeated ones, empty ones and ones that are not text', () => {
    const messy = {
      ...goodCard,
      tips: [...tips(16), 'I am the Eiffel Tower, of course.', 'The EIFFEL-TOWER is my name.', tips(1)[0], '', '   ', 42, null, { tip: 'x' }],
    };
    const parsed = parseCard(JSON.stringify(messy));
    expect(parsed).toMatchObject({ ok: true, complete: false });
    expect(parsed.ok && parsed.card.tips).toEqual(tips(16));
  });

  it('accepts a card with some tips missing, saying it is not complete', () => {
    const parsed = parseCard(JSON.stringify({ ...goodCard, tips: tips(12) }));
    expect(parsed).toMatchObject({ ok: true, complete: false });
    expect(parsed.ok && parsed.card.tips).toHaveLength(12);
  });

  it('refuses a card with too few tips, no tips, no answer, or something that is not a card', () => {
    expect(parseCard(JSON.stringify({ ...goodCard, tips: tips(9) }))).toEqual({ ok: false, detail: 'only 9 usable tips' });
    expect(parseCard(JSON.stringify({ ...goodCard, tips: 'I am tall. I am in Paris.' }))).toEqual({ ok: false, detail: 'no list of tips' });
    expect(parseCard(JSON.stringify({ ...goodCard, answer: '' }))).toEqual({ ok: false, detail: 'no answer' });
    expect(parseCard(JSON.stringify({ ...goodCard, answer: 12 }))).toEqual({ ok: false, detail: 'no answer' });
    expect(parseCard('I am sorry, I cannot help with that.')).toEqual({ ok: false, detail: 'no JSON object in the reply' });
    expect(parseCard('')).toMatchObject({ ok: false });
  });

  it('keeps the answer the player typed, whatever the model called it', () => {
    const parsed = parseCard(JSON.stringify({ ...goodCard, answer: 'The Eiffel Tower (Paris)' }), 'Eiffel Tower');
    expect(parsed.ok && parsed.card.answer).toBe('Eiffel Tower');
    // and a card that forgot the answer is fine when the player gave it
    expect(parseCard(JSON.stringify({ tips: tips(20) }), 'Eiffel Tower')).toMatchObject({ ok: true });
  });

  it('cuts answers and tips that are too long, and ignores aliases that are not text', () => {
    const parsed = parseCard(JSON.stringify({ answer: 'A'.repeat(100), aliases: [1, 'B'], tips: tips(20).map((t) => t + ' x'.repeat(200)) }));
    expect(parsed.ok && parsed.card.answer).toHaveLength(60);
    expect(parsed.ok && parsed.card.tips[0].length).toBeLessThanOrEqual(160);
    expect(parsed.ok && parsed.card.aliases).toEqual(['B']);
  });
});

describe('asking the service', () => {
  it('returns the card of a good reply', async () => {
    const { fetchImpl, calls } = fakeService(completion(JSON.stringify(goodCard)));
    const result = await generateCard({ category: 'place', locale: 'en' }, config, fetchImpl);
    expect(result).toMatchObject({ ok: true, complete: true, card: { answer: 'Eiffel Tower' } });
    expect(calls).toHaveLength(1);
  });

  it('asks once more when the first reply is not a usable card', async () => {
    const { fetchImpl, calls } = fakeService(completion('Here are some ideas: the Eiffel Tower is tall...'), completion(JSON.stringify(goodCard)));
    expect(await generateCard({ category: 'place', locale: 'en' }, config, fetchImpl)).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('gives up after two unusable replies', async () => {
    const { fetchImpl, calls } = fakeService(completion('{"answer": "X", "tips": ["only one"]}'), completion('not json'));
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, fetchImpl)).toEqual({
      ok: false,
      code: 'badOutput',
      detail: 'no JSON object in the reply',
    });
    expect(calls).toHaveLength(2);
  });

  it('copes with replies that are not chat completions', async () => {
    const weird = new Response(JSON.stringify({ error: null, choices: [] }), { status: 200 });
    const html = new Response('<html>Bad gateway</html>', { status: 200 });
    const { fetchImpl } = fakeService(weird, html);
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, fetchImpl)).toMatchObject({ ok: false, code: 'badOutput' });
    const { fetchImpl: nonText } = fakeService(completion({ answer: 'X' }));
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, nonText)).toMatchObject({ ok: false, code: 'badOutput' });
  });

  it('reports a refused key, busy free limits and failures of the service', async () => {
    const answerWith = (status: number) => fakeService(new Response('{"error":{"message":"nope"}}', { status })).fetchImpl;
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, answerWith(401))).toMatchObject({ ok: false, code: 'providerRejected', detail: expect.stringContaining('HTTP 401') });
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, answerWith(404))).toMatchObject({ code: 'providerRejected' });
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, answerWith(429))).toMatchObject({ code: 'providerBusy' });
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, answerWith(500))).toMatchObject({ code: 'providerError' });
    const offline = fakeService(new TypeError('fetch failed')).fetchImpl;
    expect(await generateCard({ category: 'thing', locale: 'en' }, config, offline)).toMatchObject({ code: 'providerError', detail: expect.stringContaining('fetch failed') });
  });

  it('stops waiting for a service that does not answer', async () => {
    const never = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await generateCard({ category: 'thing', locale: 'en' }, { ...config, timeoutMs: 50 }, never)).toEqual({ ok: false, code: 'providerError', detail: 'timed out' });
  });

  it('does nothing without a key', async () => {
    expect(await generateCard({ category: 'thing', locale: 'en' }, null)).toEqual({ ok: false, code: 'notConfigured' });
  });
});

describe('the server address /api/cards/generate', () => {
  // the server notes failures of the service in its log; keep the test output quiet
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const server = (replies: Parameters<typeof fakeService>, limit = 5) => {
    const service = fakeService(...replies);
    return {
      ...service,
      app: createGameServer({ cards: testCards, layout: noSpecials, generator: { config, fetch: service.fetchImpl }, generateLimitPerMinute: limit }).app,
    };
  };

  it('says whether the feature is set up', async () => {
    expect((await request(server([completion('')]).app).get('/api/cards/generate')).body).toEqual({ available: true });
    const off = createGameServer({ cards: testCards, generator: { config: null } }).app;
    expect((await request(off).get('/api/cards/generate')).body).toEqual({ available: false });
    const res = await request(off).post('/api/cards/generate').send({ category: 'thing' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: { code: 'notConfigured' } });
  });

  it('returns a card, in the language asked for', async () => {
    const { app, calls } = server([completion(JSON.stringify({ ...goodCard, tips: tips(20, 'Dica') }))]);
    const res = await request(app).post('/api/cards/generate').send({ category: 'place', answer: 'Torre Eiffel', locale: 'pt-BR' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, complete: true, card: { answer: 'Torre Eiffel' } });
    expect(res.body.card.tips).toHaveLength(20);
    expect(calls[0].body.messages[0].content).toContain('Brazilian Portuguese');
  });

  it('refuses requests it cannot understand', async () => {
    const { app, calls } = server([completion(JSON.stringify(goodCard))]);
    for (const body of [{}, { category: 'animal' }, { category: 'thing', answer: 42 }]) {
      const res = await request(app).post('/api/cards/generate').send(body);
      expect([res.status, res.body]).toEqual([400, { ok: false, error: { code: 'badRequest' } }]);
    }
    expect(calls).toHaveLength(0);
  });

  it('passes on the reason when no card can be made, never the key or the service details', async () => {
    const { app } = server([completion('no card, sorry')]);
    const res = await request(app).post('/api/cards/generate').send({ category: 'thing' });
    expect([res.status, res.body]).toEqual([502, { ok: false, error: { code: 'badOutput' } }]);
    const busy = server([new Response('slow down', { status: 429 })]).app;
    expect((await request(busy).post('/api/cards/generate').send({ category: 'thing' })).body).toEqual({ ok: false, error: { code: 'providerBusy' } });
    expect(JSON.stringify(res.body)).not.toContain('test-key');
  });

  it('counts each visitor separately when the server sits behind a proxy', async () => {
    const service = fakeService(completion(JSON.stringify(goodCard)));
    const app = createGameServer({ cards: testCards, generator: { config, fetch: service.fetchImpl }, generateLimitPerMinute: 1, trustProxy: 1 }).app;
    const ask = (visitor: string) => request(app).post('/api/cards/generate').set('X-Forwarded-For', visitor).send({ category: 'thing' });
    expect((await ask('203.0.113.7')).status).toBe(200);
    expect((await ask('203.0.113.7')).status).toBe(429);
    expect((await ask('198.51.100.9')).status).toBe(200); // another visitor is not held back
  });

  it('limits how many cards one address can ask for in a minute', async () => {
    const { app, calls } = server([completion(JSON.stringify(goodCard))], 2);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await request(app).post('/api/cards/generate').send({ category: 'thing' })).status);
    expect(codes).toEqual([200, 200, 429]);
    expect(calls).toHaveLength(2);
  });
});
