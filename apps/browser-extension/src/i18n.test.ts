import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CATALOGS, isLanguage, LANGUAGES, translate } from './i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

test('every message exists in both languages, with the same placeholders', () => {
  const keys = new Set(LANGUAGES.flatMap((l) => Object.keys(CATALOGS[l])));
  for (const key of keys) {
    for (const lang of LANGUAGES) {
      const msg = CATALOGS[lang][key]?.message;
      assert.ok(msg && msg.trim() !== '', `${lang} lacks "${key}"`);
    }
    assert.deepEqual(placeholders(CATALOGS.it[key]!.message), placeholders(CATALOGS.en[key]!.message), `placeholders of "${key}"`);
  }
});

test('every message the code asks for by name exists', () => {
  const src = path.join(import.meta.dirname ?? '.', '.');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(dir, f.name));
      else if (/\.(ts|tsx)$/.test(f.name) && !f.name.endsWith('.test.ts')) files.push(path.join(dir, f.name));
    }
  };
  walk(src);
  const missing: string[] = [];
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\b(?:t|tr)\(\s*'([A-Za-z0-9_]+)'/g)) {
      if (!CATALOGS.en[m[1]!]) missing.push(`${path.basename(file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('translate fills placeholders and falls back to English, then to the key', () => {
  assert.equal(translate('en', 'panelAmount', { amount: '1m' }), 'Jump: 1m');
  assert.equal(translate('it', 'panelAmount', { amount: '1m' }), 'Salto: 1m');
  assert.equal(translate('it', 'no_such_key'), 'no_such_key');
  assert.equal(isLanguage('it'), true);
  assert.equal(isLanguage('fr'), false);
});
