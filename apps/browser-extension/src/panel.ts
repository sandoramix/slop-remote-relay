import type { Command } from '@relay/protocol';
import { DEFAULT_JUMP_PRESETS, DEFAULT_JUMP_SECONDS, MAX_JUMP_SECONDS } from '@relay/protocol';

/**
 * The skip panel's logic, free of the DOM and of `chrome.*` so it can be unit
 * tested: its settings, the key combinations that drive it, and the command a
 * jump becomes. The panel (overlay, keys, popup) only sends the same
 * `playback.seek` the phone sends, so the worker picks the tab, the frame and
 * the way to seek exactly as it does for a remote command.
 */

// -------------------------------------------------------------- settings

export const ACTIONS = ['back', 'forward', 'nextAmount', 'prevAmount', 'overlay'] as const;
export type PanelAction = (typeof ACTIONS)[number];

/**
 * Alt+Shift: not a bare key (YouTube, Netflix, Twitch, Prime all live on bare
 * keys and arrows), not Ctrl+Alt (that is AltGr on many European layouts), and
 * not a combination the browser itself uses. Stored as `KeyboardEvent.code`, so
 * they mean the same key on any layout.
 */
export const DEFAULT_BINDINGS: Record<PanelAction, string> = {
  back: 'Alt+Shift+ArrowLeft',
  forward: 'Alt+Shift+ArrowRight',
  nextAmount: 'Alt+Shift+ArrowUp',
  prevAmount: 'Alt+Shift+ArrowDown',
  overlay: 'Alt+Shift+KeyS',
};

/**
 * How the panel looks and is operated on the video. Every style also answers
 * the keyboard shortcuts.
 *  - pills:    back and forward on the video's edges; hover one to pick the amount
 *  - dock:     one slim tab on the edge that opens into buttons and amounts
 *  - gesture:  no buttons; hold Alt and scroll over the video
 *  - timeline: no buttons; shortcuts or Alt + scroll, and a bar that shows where you landed
 */
export const STYLES = ['pills', 'dock', 'gesture', 'timeline'] as const;
export type PanelStyle = (typeof STYLES)[number];

/** How often the one-time tip has been shown, and whether the person has found the feature since. */
export interface Hints {
  shown: number;
  done: boolean;
}

export const MAX_HINTS = 3;

export interface PanelSettings {
  /** The panel over the video: on pointer movement, or never. */
  overlay: 'hover' | 'off';
  style: PanelStyle;
  hints: Hints;
  /** Whether the keyboard shortcuts act at all. */
  keys: boolean;
  /** Show "+30s" for a moment after a shortcut. */
  toast: boolean;
  /** Seconds. Any number of them, any size, like the phone's chips. */
  presets: number[];
  /** The chip selected, in seconds. */
  selected: number;
  bindings: Record<PanelAction, string>;
  /** Hostnames where neither the overlay nor the shortcuts act. */
  offHosts: string[];
}

export const MAX_PRESETS = 24;

export const DEFAULT_PANEL: PanelSettings = {
  overlay: 'hover',
  style: 'pills',
  hints: { shown: 0, done: false },
  keys: true,
  toast: true,
  presets: [...DEFAULT_JUMP_PRESETS],
  selected: DEFAULT_JUMP_SECONDS,
  bindings: { ...DEFAULT_BINDINGS },
  offHosts: [],
};

const validSeconds = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_JUMP_SECONDS;

/** Whatever storage returned → settings. A bad field falls back to its default, never throws. */
export function normalizePanel(raw: unknown): PanelSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PanelSettings, unknown>>;
  const presets = Array.isArray(r.presets) ? [...new Set(r.presets.filter(validSeconds))].sort((a, b) => a - b) : [];
  const bindings = { ...DEFAULT_BINDINGS };
  const stored = (r.bindings && typeof r.bindings === 'object' ? r.bindings : {}) as Record<string, unknown>;
  for (const action of ACTIONS) {
    const combo = stored[action];
    if (typeof combo === 'string' && comboProblem(combo) !== 'needsModifier') bindings[action] = combo;
  }
  const hints = (r.hints && typeof r.hints === 'object' ? r.hints : {}) as Partial<Record<keyof Hints, unknown>>;
  return {
    overlay: r.overlay === 'off' ? 'off' : 'hover',
    style: STYLES.find((x) => x === r.style) ?? DEFAULT_PANEL.style,
    hints: {
      shown: typeof hints.shown === 'number' && Number.isInteger(hints.shown) && hints.shown >= 0 ? Math.min(hints.shown, 99) : 0,
      done: hints.done === true,
    },
    keys: r.keys !== false,
    toast: r.toast !== false,
    presets: (presets.length > 0 ? presets : DEFAULT_PANEL.presets).slice(0, MAX_PRESETS),
    selected: validSeconds(r.selected) ? r.selected : DEFAULT_PANEL.selected,
    bindings,
    offHosts: Array.isArray(r.offHosts) ? r.offHosts.filter((h): h is string => typeof h === 'string' && h !== '') : [],
  };
}

/** The chips to show: the presets, plus the selected amount if it is not one of them. */
export function chips(p: Pick<PanelSettings, 'presets' | 'selected'>): number[] {
  return p.presets.includes(p.selected) ? p.presets : [...p.presets, p.selected].sort((a, b) => a - b);
}

export function addPreset(presets: number[], seconds: number): number[] {
  if (!validSeconds(seconds) || presets.includes(seconds) || presets.length >= MAX_PRESETS) return presets;
  return [...presets, seconds].sort((a, b) => a - b);
}

/** Always leaves at least one. */
export function removePreset(presets: number[], seconds: number): number[] {
  return presets.length > 1 ? presets.filter((p) => p !== seconds) : presets;
}

/**
 * The next (dir 1) or previous (-1) amount, wrapping at the ends. An amount that
 * is not a preset (typed once, not saved) moves to the nearest preset on that side.
 */
export function stepAmount(presets: number[], selected: number, dir: 1 | -1): number {
  const sorted = chips({ presets, selected });
  const i = sorted.indexOf(selected);
  return sorted[(i + dir + sorted.length) % sorted.length]!;
}

/** The amounts either side of the selected one, with nothing past the ends (a picker does not wrap). */
export function neighbours(p: Pick<PanelSettings, 'presets' | 'selected'>): { lower: number | null; higher: number | null } {
  const sorted = chips(p);
  const i = sorted.indexOf(p.selected);
  return { lower: sorted[i - 1] ?? null, higher: sorted[i + 1] ?? null };
}

/** Whether the one-time tip may still be shown. */
export const wantsHint = (p: Pick<PanelSettings, 'hints'>): boolean => !p.hints.done && p.hints.shown < MAX_HINTS;

/** Jumps made in quick succession, shown as one running total: +30s, +1m, ... */
export interface Run {
  dir: 1 | -1;
  seconds: number;
  at: number;
  /** True when this jump started a new run rather than adding to one. */
  fresh: boolean;
}

export function addToRun(run: Run | null, dir: 1 | -1, seconds: number, now: number, gapMs: number): Run {
  return run && run.dir === dir && now - run.at < gapMs
    ? { dir, seconds: run.seconds + seconds, at: now, fresh: false }
    : { dir, seconds, at: now, fresh: true };
}

/** Where a position falls along a video, 0..1, or null when either is unknown. */
export function fraction(ms: number | null, durationMs: number | null): number | null {
  if (ms === null || durationMs === null || !(durationMs > 0)) return null;
  return Math.min(1, Math.max(0, ms / durationMs));
}

/** Where a jump from `fromMs` lands, kept inside the video the way the worker does. */
export function landing(fromMs: number, deltaMs: number, durationMs: number | null): number {
  const max = durationMs !== null ? Math.max(0, durationMs - 250) : Infinity;
  return Math.min(Math.max(0, fromMs + deltaMs), max);
}

export const hostOff = (offHosts: string[], host: string): boolean =>
  offHosts.some((h) => host === h || host.endsWith(`.${h}`));

/** Turns the panel off for a host, or back on. */
export function setHostOff(offHosts: string[], host: string, off: boolean): string[] {
  const rest = offHosts.filter((h) => h !== host);
  return off ? [...rest, host].sort() : rest;
}

/** What a jump sends: the very command the phone's seek keys send. */
export function jumpCommand(direction: 1 | -1, seconds: number): Command {
  return { op: 'playback.seek', deltaMs: direction * seconds * 1000 };
}

// ------------------------------------------------------------------ keys

/** The part of a KeyboardEvent a combination is made from. */
export interface KeyLike {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$|^AltGraph$|^CapsLock$|^Fn$/;

const MODIFIER_NAMES = ['Ctrl', 'Alt', 'Shift', 'Meta'];

/** "Ctrl+Alt+Shift+Meta+<code>", modifiers always in that order. */
export function comboFromEvent(e: KeyLike): string | null {
  if (!e.code || e.code === 'Unidentified' || MODIFIER_CODES.test(e.code)) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.code].filter(Boolean).join('+');
}

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  code: string;
}

export function parseCombo(combo: string): Combo | null {
  const parts = combo.split('+');
  const code = parts.pop();
  if (!code || MODIFIER_CODES.test(code) || MODIFIER_NAMES.includes(code)) return null;
  const has = (m: string) => parts.includes(m);
  if (parts.some((p) => !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(p))) return null;
  const parsed = { ctrl: has('Ctrl'), alt: has('Alt'), shift: has('Shift'), meta: has('Meta'), code };
  // Only the canonical spelling is accepted, so equal combinations compare equal as strings.
  const canonical = comboFromEvent({ code, ctrlKey: parsed.ctrl, altKey: parsed.alt, shiftKey: parsed.shift, metaKey: parsed.meta });
  return canonical === combo ? parsed : null;
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
};

/** "Alt+Shift+ArrowLeft" → "Alt + Shift + ←" (⌥ ⇧ on a Mac). */
export function formatCombo(combo: string, mac = false): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  const name = KEY_NAMES[parsed.code] ?? parsed.code.replace(/^Key|^Digit|^Numpad/, (m) => (m === 'Numpad' ? 'Num ' : ''));
  const mods = mac
    ? [parsed.ctrl && '⌃', parsed.alt && '⌥', parsed.shift && '⇧', parsed.meta && '⌘']
    : [parsed.ctrl && 'Ctrl', parsed.alt && 'Alt', parsed.shift && 'Shift', parsed.meta && 'Win'];
  return [...mods.filter(Boolean), name].join(' + ');
}

/** What is wrong with a combination as a choice, if anything. */
export type ComboProblem = 'needsModifier' | 'altGr' | 'browser';

// Combinations the browser handles itself; a page rarely sees them at all.
const BROWSER_KEYS = new Set([
  'Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+KeyL', 'Ctrl+KeyR', 'Ctrl+KeyF', 'Ctrl+KeyD', 'Ctrl+KeyP', 'Ctrl+KeyS',
  'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyN', 'Ctrl+Shift+KeyW', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+ArrowLeft', 'Alt+ArrowRight',
  'Alt+F4', 'Alt+Tab', 'Alt+Home', 'Meta+KeyW', 'Meta+KeyT', 'Meta+KeyN', 'Meta+KeyL', 'Meta+KeyR', 'Meta+KeyQ', 'Meta+Tab',
]);

export function comboProblem(combo: string): ComboProblem | null {
  const c = parseCombo(combo);
  if (!c) return 'needsModifier';
  // Shift alone only capitalises: a bare or Shift-only key would fire while typing.
  if (!c.ctrl && !c.alt && !c.meta) return 'needsModifier';
  if (c.ctrl && c.alt && !c.meta) return 'altGr';
  return BROWSER_KEYS.has(combo) ? 'browser' : null;
}

/** The action already using this combination, if any. */
export function boundTo(bindings: Record<PanelAction, string>, combo: string, except?: PanelAction): PanelAction | null {
  return ACTIONS.find((a) => a !== except && bindings[a] === combo) ?? null;
}

/**
 * Combinations a site binds itself, from `keys` in sites.json. Not a
 * guarantee either way: the page's list is what its documentation says.
 */
export function siteKeys(sites: Record<string, { keys?: string[] }>, host: string): string[] {
  const key = Object.keys(sites).find((d) => !d.startsWith('_') && (host === d || host.endsWith(`.${d}`)));
  return (key && sites[key]?.keys) || [];
}

/** The action a key press means, or null (also when shortcuts are off). */
export function actionFor(p: PanelSettings, e: KeyLike): PanelAction | null {
  const combo = p.keys ? comboFromEvent(e) : null;
  return combo ? boundTo(p.bindings, combo) : null;
}
