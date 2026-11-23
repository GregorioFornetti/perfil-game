import { CATEGORIES, Category, MAX_ANSWER_LENGTH, MAX_OWN_ALIASES, MAX_TIP_LENGTH, TIPS_PER_CARD } from './types';

/**
 * Writes a card (answer, other accepted answers, 20 tips) by asking a large language model.
 *
 * Any service with an OpenAI-style "chat completions" API works: Groq, Google Gemini,
 * OpenRouter, a local Ollama... It is set up with environment variables (see .env.example):
 *   LLM_API_KEY    the secret key of the service (required; without it the feature is off)
 *   LLM_BASE_URL   where the API is (default: Groq)
 *   LLM_MODEL      which model to ask
 *   LLM_JSON_MODE  "false" for services that do not accept response_format (default: true)
 * The key stays on the server: browsers only ever talk to /api/cards/generate.
 */

export interface GeneratorConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  timeoutMs: number;
}

export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export function configFromEnv(env: Record<string, string | undefined>): GeneratorConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.LLM_MODEL?.trim() || DEFAULT_MODEL,
    jsonMode: env.LLM_JSON_MODE?.trim().toLowerCase() !== 'false',
    timeoutMs: Number(env.LLM_TIMEOUT_MS) > 0 ? Number(env.LLM_TIMEOUT_MS) : 30_000,
  };
}

export interface GenerateRequest {
  category: Category;
  /** The answer the player already typed, if any; otherwise the model picks one. */
  answer?: string;
  /** Language of the card. */
  locale: 'en' | 'pt-BR';
}

export interface GeneratedCard {
  answer: string;
  aliases: string[];
  tips: string[];
}

export type GenerateResult =
  | { ok: true; card: GeneratedCard; complete: boolean }
  | { ok: false; code: GenerateError; detail?: string };

/**
 * notConfigured: no key; providerRejected: the service refused the key or the request;
 * providerBusy: the service's free limits were hit; providerError: the service could not be
 * reached or failed; badOutput: the model's answer could not be turned into a card.
 */
export type GenerateError = 'notConfigured' | 'providerRejected' | 'providerBusy' | 'providerError' | 'badOutput';

/** Fewer good tips than this and the answer is treated as a failure (and asked for again). */
export const MIN_USABLE_TIPS = 10;

const CATEGORY_WORDS: Record<Category, { en: string; pt: string }> = {
  thing: { en: 'a thing (an everyday object)', pt: 'uma coisa (um objeto do dia a dia)' },
  person: { en: 'a famous person', pt: 'uma pessoa famosa' },
  place: { en: 'a place (a country, city or famous sight)', pt: 'um lugar (um país, cidade ou ponto turístico)' },
  year: { en: 'a year (famous for world events)', pt: 'um ano (famoso por acontecimentos mundiais)' },
};

export function buildMessages(req: GenerateRequest): { role: 'system' | 'user'; content: string }[] {
  const pt = req.locale === 'pt-BR';
  const language = pt ? 'Brazilian Portuguese' : 'English';
  const style =
    req.category === 'year'
      ? pt
        ? 'Each tip starts like "Neste ano, ..." / "Nesse ano, ...".'
        : 'Each tip starts like "In this year, ...".'
      : 'Tips are written in the first person, as if the answer were speaking ("I am...", "I was born...").';
  const system = [
    'You write cards for a party guessing game like "20 Questions" (the Brazilian board game "Perfil").',
    'A card has a secret answer and exactly 20 tips; players hear tips one at a time and try to guess the answer.',
    `Write everything in ${language}.`,
    style,
    'Rules for the tips: exactly 20; each one short sentence (at most 120 characters); all facts true and well known;',
    'never contain the answer or an obvious part of it; a mix of hard, medium and easy tips in random order; no two alike.',
    'Also give "aliases": other names or spellings of the answer that should count as right (may be empty).',
    'Reply with ONLY a JSON object, no other text: {"answer": "...", "aliases": ["..."], "tips": ["...", ... 20 tips]}',
  ].join(' ');
  const what = CATEGORY_WORDS[req.category][pt ? 'pt' : 'en'];
  const user = req.answer?.trim()
    ? `Category: ${what}. The answer is: "${req.answer.trim()}". Write the card for it.`
    : `Category: ${what}. Choose a well-known answer yourself (not too obscure) and write the card.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Same letters, ignoring case, accents and punctuation: to spot a tip that gives the answer away. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Finds the JSON object in a model's reply, which may come wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Turns a model's reply into a card, or says why it cannot. Tidies what can be tidied:
 * numbering in front of tips, extra tips, duplicates, tips that give the answer away.
 */
export function parseCard(text: string, wantedAnswer?: string): { ok: true; card: GeneratedCard; complete: boolean } | { ok: false; detail: string } {
  const data = extractJson(text) as Partial<Record<string, unknown>> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, detail: 'no JSON object in the reply' };
  const answer = clean(wantedAnswer, MAX_ANSWER_LENGTH) || clean(data.answer, MAX_ANSWER_LENGTH);
  if (!answer) return { ok: false, detail: 'no answer' };
  if (!Array.isArray(data.tips)) return { ok: false, detail: 'no list of tips' };
  const key = plain(answer);
  const seen = new Set<string>();
  const tips: string[] = [];
  for (const raw of data.tips) {
    // "1. I am...", "- I am...", "Tip 3: I am..."
    const tip = clean(raw, 500)
      .replace(/^(?:(?:tip|dica)\s*)?\d{1,2}\s*[.):-]\s*/i, '')
      .replace(/^[-*•]\s*/, '')
      .slice(0, MAX_TIP_LENGTH);
    const p = plain(tip);
    if (!p || seen.has(p)) continue;
    if (key && ` ${p} `.includes(` ${key} `)) continue; // gives the answer away
    seen.add(p);
    tips.push(tip);
    if (tips.length === TIPS_PER_CARD) break;
  }
  if (tips.length < MIN_USABLE_TIPS) return { ok: false, detail: `only ${tips.length} usable tips` };
  const aliases = Array.isArray(data.aliases)
    ? [...new Set(data.aliases.map((a) => clean(a, MAX_ANSWER_LENGTH)).filter((a) => a && plain(a) !== key))].slice(0, MAX_OWN_ALIASES)
    : [];
  return { ok: true, card: { answer, aliases, tips }, complete: tips.length === TIPS_PER_CARD };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Asks the model once. */
async function ask(req: GenerateRequest, config: GeneratorConfig, fetchImpl: FetchLike): Promise<{ text: string } | { code: GenerateError; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(req),
        temperature: 0.7,
        max_tokens: 2000,
        ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = `HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`;
      if (response.status === 429) return { code: 'providerBusy', detail };
      if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
        return { code: 'providerRejected', detail };
      }
      return { code: 'providerError', detail };
    }
    const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') return { code: 'badOutput', detail: 'the reply has no message text' };
    return { text };
  } catch (err) {
    return { code: 'providerError', detail: controller.signal.aborted ? 'timed out' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the model for a card; asks once more if the first reply cannot be used. */
export async function generateCard(req: GenerateRequest, config: GeneratorConfig | null, fetchImpl: FetchLike = fetch): Promise<GenerateResult> {
  if (!config) return { ok: false, code: 'notConfigured' };
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask(req, config, fetchImpl);
    if ('code' in reply) {
      if (reply.code !== 'badOutput') return { ok: false, code: reply.code, detail: reply.detail };
      last = reply.detail;
      continue;
    }
    const parsed = parseCard(reply.text, req.answer);
    if (parsed.ok) return parsed;
    last = parsed.detail;
  }
  return { ok: false, code: 'badOutput', detail: last };
}

export function isCategory(value: unknown): value is Category {
  return CATEGORIES.includes(value as Category);
}
