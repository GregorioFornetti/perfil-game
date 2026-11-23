import en from '../src/locales/en.json';
import pt from '../src/locales/pt-BR.json';
import fs from 'node:fs';
import path from 'node:path';
import { resolveLocale, translateError } from '../src/i18n';

describe('server translations', () => {
  it('has the same keys in English and Portuguese', () => {
    expect(Object.keys(pt.errors).sort()).toEqual(Object.keys(en.errors).sort());
  });

  it('has a message for every error the game can raise', () => {
    const src = path.join(__dirname, '../src');
    const files = ['game/Game.ts', 'game/RoomManager.ts', 'server.ts'].map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
    const codes = new Set([...files.join('\n').matchAll(/new GameError\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    for (const code of codes) expect(Object.keys(en.errors)).toContain(code);
  });

  it('translates by locale and fills in numbers', () => {
    expect(translateError('notYourTurn', 'en')).toBe('It is not your turn.');
    expect(translateError('notYourTurn', 'pt-BR')).toBe('Não é a sua vez.');
    expect(translateError('invalidGoal', 'pt-BR')).toBe('O número de casas para vencer deve estar entre 20 e 300.');
    expect(translateError('somethingUnknown', 'en')).toBe('Something went wrong on the server.');
  });

  it('maps browser languages to a supported locale', () => {
    expect(resolveLocale('pt-BR')).toBe('pt-BR');
    expect(resolveLocale('pt')).toBe('pt-BR');
    expect(resolveLocale('pt-PT,pt;q=0.9')).toBe('pt-BR');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
});
