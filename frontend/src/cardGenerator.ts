import type { Category } from './types';

// Asks the game server to write a card with its AI service (the server holds the key).

export interface GeneratedCard {
  answer: string;
  aliases: string[];
  tips: string[];
}

export type GenerateReply =
  | { ok: true; card: GeneratedCard; complete: boolean }
  | { ok: false; code: string };

/** Whether the server has an AI service set up (if not, the button is not shown). */
export async function generatorAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/cards/generate');
    const body = (await res.json()) as { available?: unknown };
    return body.available === true;
  } catch {
    return false;
  }
}

export async function generateCard(category: Category, answer: string, locale: string): Promise<GenerateReply> {
  try {
    const res = await fetch('/api/cards/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, answer: answer.trim() || undefined, locale }),
    });
    const body = (await res.json().catch(() => null)) as (GenerateReply & { error?: { code?: string } }) | null;
    if (body?.ok === true && Array.isArray(body.card?.tips)) return body;
    return { ok: false, code: body?.error?.code ?? 'providerError' };
  } catch {
    return { ok: false, code: 'network' };
  }
}
