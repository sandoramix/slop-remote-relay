import en from '../public/_locales/en/messages.json';
import it from '../public/_locales/it/messages.json';

/**
 * The extension's own language, chosen in the popup. `chrome.i18n` can only
 * follow the browser's language, so the two catalogs in `public/_locales` are
 * also bundled here and looked up by hand. English is the default whatever the
 * browser says, like the apps; Italian is a choice. The manifest's name and
 * description still come from `chrome.i18n` (Chrome reads those itself), so
 * they follow the browser.
 */

export const LANGUAGES = ['en', 'it'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language in its own words, for the picker. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', it: 'Italiano' };

type Catalog = Record<string, { message: string }>;
export const CATALOGS: Record<Language, Catalog> = { en, it };

let current: Language = 'en';

export const getLanguage = (): Language => current;

export function setLanguage(language: Language): void {
  current = language;
}

export const isLanguage = (x: unknown): x is Language => LANGUAGES.some((l) => l === x);

/** A message with {name} placeholders filled in; the English one if this language lacks it, the key if both do. */
export function translate(language: Language, key: string, vars: Record<string, string | number> = {}): string {
  const msg = CATALOGS[language][key]?.message ?? CATALOGS.en[key]?.message ?? key;
  return msg.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export const tr = (key: string, vars: Record<string, string | number> = {}): string => translate(current, key, vars);

/** What is stored: its own key, so changing it never restarts the transports. */
export async function loadLanguage(): Promise<Language> {
  const stored = (await chrome.storage.local.get('language')) as { language?: unknown };
  return isLanguage(stored.language) ? stored.language : 'en';
}

export async function saveLanguage(language: Language): Promise<void> {
  await chrome.storage.local.set({ language });
}
