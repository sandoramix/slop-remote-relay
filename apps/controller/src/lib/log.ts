import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { useSettings } from '../state/settings';

/**
 * The controller's own log: what the app did, kept on the phone so it can be
 * sent to the developer. Same idea as the receiver's `AppLog`.
 *
 * Lines are kept in memory and written to AsyncStorage a moment after the last
 * one, trimmed to the newest MAX_LINES. What identifies a pairing (the code, its
 * secret and room) is registered with `hide` and replaced in every line, so a
 * log can be pasted into a public issue.
 */

const KEY = 'relay.log.v1';
const MAX_LINES = 600;
const SAVE_AFTER_MS = 1500;
const MASK = '‹hidden›';

type Level = 'D' | 'I' | 'W' | 'E';

let lines: string[] = [];
let hidden: string[] = [];
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function stamp(date = new Date()): string {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const scrub = (text: string) => hidden.reduce((acc, secret) => acc.split(secret).join(MASK), text);

/** Older lines come back from storage once, and go ahead of anything written meanwhile. */
function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((saved) => {
      if (saved) lines = [...saved.split('\n'), ...lines].slice(-MAX_LINES);
    })
    .catch(() => undefined);
  return loaded;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void load().then(() => AsyncStorage.setItem(KEY, lines.join('\n'))).catch(() => undefined);
  }, SAVE_AFTER_MS);
}

function write(level: Level, tag: string, message: string) {
  lines.push(`${stamp()} ${level}/${tag}: ${scrub(message)}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  void load();
  save();
}

export const log = {
  d: (tag: string, message: string) => write('D', tag, message),
  i: (tag: string, message: string) => write('I', tag, message),
  w: (tag: string, message: string) => write('W', tag, message),
  e: (tag: string, message: string) => write('E', tag, message),
};

/** Values that must never reach the log (pair code, secret, room). Short ones are ignored. */
export function hideFromLog(...values: (string | null | undefined)[]) {
  hidden = [...hidden, ...values.filter((v): v is string => !!v && v.length >= 4)];
}

export async function clearLog() {
  await load();
  lines = [];
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

/** The log with what a developer asks first: app, device, language. */
export async function collectReport(extra: Record<string, string> = {}) {
  await load();
  return {
    version: Constants.expoConfig?.version ?? '?',
    details: [
      `${Platform.OS} ${Platform.Version}, ${Device.manufacturer ?? '?'} ${Device.modelName ?? '?'}`,
      `App language: ${useSettings.getState().language}`,
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    ],
    log: lines.join('\n'),
  };
}

export async function buildReport(extra: Record<string, string> = {}): Promise<string> {
  const { version, details, log: text } = await collectReport(extra);
  return [`Skipper controller ${version}`, ...details, '---', text].join('\n');
}

let installed = false;

/** Crashes and console warnings/errors end up in the log too. Call once at startup. */
export function installLogCapture() {
  if (installed) return;
  installed = true;
  log.i('app', 'start');

  const globals = globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } };
  const previous = globals.ErrorUtils?.getGlobalHandler();
  globals.ErrorUtils?.setGlobalHandler((error, fatal) => {
    const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    write('E', fatal ? 'crash' : 'error', text.trimEnd());
    // The process may be about to die: write now rather than after the debounce.
    void AsyncStorage.setItem(KEY, lines.join('\n')).catch(() => undefined);
    previous?.(error, fatal);
  });

  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(level === 'warn' ? 'W' : 'E', 'console', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
      original(...args);
    };
  }
}
