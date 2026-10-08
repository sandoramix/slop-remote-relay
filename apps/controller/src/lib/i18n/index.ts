import { useCallback } from 'react';
import { useSettings, type Language } from '../../state/settings';
import { en, type TranslationKey } from './en';
import { it } from './it';

export type { TranslationKey };

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en, it };

/** Language names, each in its own language, for the selector. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', it: 'Italiano' };

export type Vars = Record<string, string | number>;

function translate(language: Language, key: TranslationKey, vars?: Vars): string {
  const template = DICTIONARIES[language][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** For code outside React (client errors, formatters): reads the current language. */
export function t(key: TranslationKey, vars?: Vars): string {
  return translate(useSettings.getState().language, key, vars);
}

/** For components: re-renders when the language changes. */
export function useT(): (key: TranslationKey, vars?: Vars) => string {
  const language = useSettings((s) => s.language);
  return useCallback((key, vars) => translate(language, key, vars), [language]);
}
