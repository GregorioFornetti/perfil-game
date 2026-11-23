import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
import type { Locale } from './types';

export const LOCALE_KEY = 'twenty-tips.locale';
export const SUPPORTED: Locale[] = ['en', 'pt-BR'];

/** Picks one of the languages we have from whatever the browser (or a saved choice) says. */
export function pickLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const c of candidates) {
    if (!c) continue;
    if (c.toLowerCase().startsWith('pt')) return 'pt-BR';
    if (c.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

export function createAppI18n(locale: Locale = 'en') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, 'pt-BR': ptBR },
  });
}
