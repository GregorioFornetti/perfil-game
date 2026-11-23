import { CATEGORIES, MAX_ANSWER_LENGTH, MAX_OWN_ALIASES, MAX_TIP_LENGTH, TIPS_PER_CARD, type Category, type OwnCard } from './types';
import type { StorageLike } from './store';

// Cards a player writes themselves. They are kept in the browser (local storage) and can be
// played, while choosing the card of a round, instead of the card drawn.

export const MY_CARDS_KEY = 'twenty-tips.my-cards';

export interface MyCard {
  id: string;
  category: Category;
  answer: string;
  /** Other accepted answers, as typed: separated by commas. */
  aliases: string;
  /** Always 20 entries; empty ones are tips not written yet. */
  tips: string[];
}

export function blankCard(): MyCard {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    category: 'thing',
    answer: '',
    aliases: '',
    tips: Array.from({ length: TIPS_PER_CARD }, () => ''),
  };
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Reads the saved cards, putting right anything damaged or out of shape. */
export function readMyCards(storage: StorageLike): MyCard[] {
  let list: unknown;
  try {
    list = JSON.parse(storage.getItem(MY_CARDS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c: Partial<MyCard>) => ({
      id: typeof c.id === 'string' && c.id ? c.id : blankCard().id,
      category: CATEGORIES.includes(c.category as Category) ? (c.category as Category) : 'thing',
      answer: text(c.answer, MAX_ANSWER_LENGTH),
      aliases: text(c.aliases, 500),
      tips: Array.from({ length: TIPS_PER_CARD }, (_, i) => text(Array.isArray(c.tips) ? c.tips[i] : '', MAX_TIP_LENGTH)),
    }));
}

export function writeMyCards(storage: StorageLike, cards: MyCard[]): void {
  storage.setItem(MY_CARDS_KEY, JSON.stringify(cards));
}

export function filledTips(card: MyCard): number {
  return card.tips.filter((tip) => tip.trim()).length;
}

/** A card can be played once it has an answer and all 20 tips. */
export function isComplete(card: MyCard): boolean {
  return card.answer.trim().length > 0 && filledTips(card) === TIPS_PER_CARD;
}

/** Nothing written at all (such a card is not worth keeping). */
export function isBlank(card: MyCard): boolean {
  return !card.answer.trim() && !card.aliases.trim() && filledTips(card) === 0;
}

/** The card in the form the server takes. */
export function toOwnCard(card: MyCard): OwnCard {
  return {
    category: card.category,
    answer: card.answer.trim(),
    aliases: card.aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, MAX_OWN_ALIASES),
    tips: card.tips.map((tip) => tip.trim()),
  };
}
