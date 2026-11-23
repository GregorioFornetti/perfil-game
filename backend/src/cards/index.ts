import fs from 'node:fs';
import path from 'node:path';
import { Card, CATEGORIES, TIPS_PER_CARD } from '../types';

const DATA_DIR = path.join(__dirname, 'data');

/** Returns a list of problems found in a card (empty when the card is fine). */
export function validateCard(card: unknown): string[] {
  const problems: string[] = [];
  const c = card as Partial<Card> | null;
  if (!c || typeof c !== 'object') return ['not an object'];
  if (typeof c.id !== 'string' || !c.id) problems.push('missing id');
  if (!CATEGORIES.includes(c.category as never)) problems.push('unknown category');
  for (const lang of ['en', 'pt'] as const) {
    if (typeof c.answer?.[lang] !== 'string' || !c.answer[lang].trim()) problems.push(`missing answer.${lang}`);
    const aliases = c.aliases?.[lang];
    if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== 'string')) problems.push(`bad aliases.${lang}`);
    const tips = c.tips?.[lang];
    if (!Array.isArray(tips) || tips.length !== TIPS_PER_CARD) {
      problems.push(`tips.${lang} must have exactly ${TIPS_PER_CARD} entries`);
    } else if (tips.some((t) => typeof t !== 'string' || !t.trim())) {
      problems.push(`tips.${lang} has an empty tip`);
    }
  }
  return problems;
}

/** Reads every .json file in the data folder. Each file holds an array of cards. */
export function loadCards(dir: string = DATA_DIR): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as unknown;
    if (!Array.isArray(list)) throw new Error(`${file}: expected an array of cards`);
    for (const card of list) {
      const problems = validateCard(card);
      const id = (card as Card)?.id ?? '?';
      if (problems.length) throw new Error(`${file}: card "${id}": ${problems.join('; ')}`);
      if (seen.has(id)) throw new Error(`${file}: duplicate card id "${id}"`);
      seen.add(id);
      cards.push(card as Card);
    }
  }
  return cards;
}
