import path from 'node:path';
import { I18n } from 'i18n';
import { Locale, LOCALES, MAX_GOAL, MAX_POINTS, MIN_GOAL } from './types';

/** Server-side translations (the messages sent back when an action is refused). */
export const i18n = new I18n({
  locales: LOCALES,
  defaultLocale: 'en',
  directory: path.join(__dirname, 'locales'),
  objectNotation: true,
  updateFiles: false,
  syncFiles: false,
  autoReload: false,
});

/** Turns whatever the browser says its language is ("pt", "pt-PT", "en-GB", ...) into one we support. */
export function resolveLocale(value: unknown): Locale {
  if (typeof value === 'string' && value.toLowerCase().startsWith('pt')) return 'pt-BR';
  return 'en';
}

export function translateError(code: string, locale: Locale): string {
  const key = `errors.${code}`;
  const text = i18n.__({ phrase: key, locale }, { min: String(MIN_GOAL), max: String(MAX_GOAL), maxPoints: String(MAX_POINTS) });
  return text === key ? i18n.__({ phrase: 'errors.internal', locale }) : text;
}
