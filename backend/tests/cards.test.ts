import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCards, validateCard } from '../src/cards';
import { normalize } from '../src/game/answer';
import { CATEGORIES } from '../src/types';
import { makeCard } from './helpers';

describe('the cards shipped with the game', () => {
  const cards = loadCards();

  it('has cards in every category', () => {
    for (const category of CATEGORIES) {
      expect(cards.filter((c) => c.category === category).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('has unique ids', () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it.each(cards.map((c) => [c.id, c] as const))('%s is well formed', (_id, card) => {
    expect(validateCard(card)).toEqual([]);
    for (const lang of ['en', 'pt'] as const) {
      expect(new Set(card.tips[lang]).size).toBe(20);
      const answer = normalize(card.answer[lang]);
      for (const tip of card.tips[lang]) {
        // a tip must not give the answer away
        expect(` ${normalize(tip)} `).not.toContain(` ${answer} `);
      }
    }
  });

  it('has no two cards that accept the same answer', () => {
    const seen = new Map<string, string>();
    for (const card of cards) {
      const names = new Set([card.answer.en, card.answer.pt, ...card.aliases.en, ...card.aliases.pt].map(normalize));
      for (const name of names) {
        expect([name, seen.get(name)]).toEqual([name, undefined]);
        seen.set(name, card.id);
      }
    }
  });
});

describe('validateCard', () => {
  it('accepts a good card', () => {
    expect(validateCard(makeCard(1))).toEqual([]);
  });

  it('reports what is wrong', () => {
    const bad = makeCard(1);
    bad.tips.en.pop();
    bad.answer.pt = '';
    expect(validateCard(bad)).toEqual(['tips.en must have exactly 20 entries', 'missing answer.pt']);
    expect(validateCard(null)).toEqual(['not an object']);
    expect(validateCard({ ...makeCard(1), category: 'animal' })).toContain('unknown category');
  });
});

describe('loadCards', () => {
  it('refuses a folder with a broken or duplicated card', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([makeCard(1), makeCard(1)]));
    expect(() => loadCards(dir)).toThrow(/duplicate card id/);
    const bad = makeCard(2);
    bad.tips.pt = [];
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([bad]));
    expect(() => loadCards(dir)).toThrow(/tips.pt must have exactly 20/);
    fs.rmSync(dir, { recursive: true });
  });
});
