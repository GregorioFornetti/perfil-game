import { Card } from '../types';

const ARTICLES = new Set(['the', 'a', 'an', 'o', 'os', 'as', 'um', 'uma']);

/** Lower-cases, strips accents, punctuation and a leading article ("The Eiffel Tower" -> "eiffel tower"). */
export function normalize(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Typos tolerated for an answer of the given (normalized) text. Numbers must match exactly. */
function tolerance(target: string): number {
  if (/^[0-9 ]+$/.test(target)) return 0;
  if (target.length >= 10) return 2;
  if (target.length >= 5) return 1;
  return 0;
}

/** True when the guess matches the card's answer or one of its aliases, in either language. */
export function isCorrectGuess(card: Card, guess: string): boolean {
  const g = normalize(guess);
  if (!g) return false;
  const targets = [card.answer.en, card.answer.pt, ...card.aliases.en, ...card.aliases.pt].map(normalize);
  return targets.some((t) => {
    if (!t) return false;
    if (t === g) return true;
    const tol = tolerance(t);
    // a digit in the guess must never be "corrected" into another one
    if (tol === 0 || /[0-9]/.test(g) !== /[0-9]/.test(t)) return false;
    return Math.abs(t.length - g.length) <= tol && levenshtein(t, g) <= tol;
  });
}
