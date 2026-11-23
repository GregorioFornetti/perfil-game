import en from '../src/locales/en.json';
import ptBR from '../src/locales/pt-BR.json';
import { createAppI18n, pickLocale } from '../src/i18n';

/** Every key of a nested object, as "a.b.c" ("a.b[]" for lists, with their length). */
function keys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) return [`${prefix}[${obj.length}]`];
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('translations', () => {
  it('has exactly the same keys in English and Portuguese', () => {
    expect(keys(ptBR).sort()).toEqual(keys(en).sort());
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().filter((v, i, a) => a.indexOf(v) === i);
    const flat = (obj: unknown, prefix = ''): [string, string][] =>
      typeof obj === 'string'
        ? [[prefix, obj]]
        : Object.entries(obj as object).flatMap(([k, v]) => flat(v, `${prefix}.${k}`));
    const pt = new Map(flat(ptBR));
    for (const [key, text] of flat(en)) {
      expect([key, placeholders(pt.get(key) ?? '')]).toEqual([key, placeholders(text)]);
    }
  });

  it('translates, with names, numbers and plurals', () => {
    const en = createAppI18n('en').global;
    const pt = createAppI18n('pt-BR').global;
    expect(en.t('game.holder', { name: 'Ana' })).toBe('Ana holds the card');
    expect(pt.t('game.holder', { name: 'Ana' })).toBe('Ana está com a carta');
    expect(en.t('game.result.moves', { name: 'Bob', n: 1 }, 1)).toBe('Bob moves 1 space');
    expect(en.t('game.result.moves', { name: 'Bob', n: 15 }, 15)).toBe('Bob moves 15 spaces');
    expect(pt.t('game.result.moves', { name: 'Bob', n: 15 }, 15)).toBe('Bob avança 15 casas');
    expect(pt.t('category.year')).toBe('Ano');
  });
});

describe('pickLocale', () => {
  it('prefers a saved choice, then the browser language, then English', () => {
    expect(pickLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(pickLocale(null, 'pt-PT')).toBe('pt-BR');
    expect(pickLocale(null, 'en-GB')).toBe('en');
    expect(pickLocale(undefined, 'fr-FR')).toBe('en');
    expect(pickLocale()).toBe('en');
  });
});
