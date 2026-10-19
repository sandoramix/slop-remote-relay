/**
 * How a jump amount is written and read. Shared by the controller's seek pad and
 * the browser extension's own skip panel, so "2m", "1:30" or "1h30m30s" means the
 * same thing wherever it is typed.
 */

/** 75 → "1:15", 3725 → "1:02:05". Input in seconds. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Chip label for a jump, in the same units it is typed in: 10 → "10s", 90 → "1m30s",
 * 300 → "5m", 3600 → "1h", 5400 → "1h30m", 5430 → "1h30m30s". Parses back to the
 * same amount.
 */
export function jumpLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}h` : ''}${m ? `${m}m` : ''}${s || (!h && !m) ? `${s}s` : ''}`;
}

/** The jump amounts a fresh install offers, in seconds: 10s, 15s, 1m, 1m30s, 5m, 10m. */
export const DEFAULT_JUMP_PRESETS: readonly number[] = [10, 15, 60, 90, 300, 600];
/** The amount selected on a fresh install, in seconds. */
export const DEFAULT_JUMP_SECONDS = 10;

/** The longest jump anyone can ask for: a day. */
export const MAX_JUMP_SECONDS = 86_400;

const UNITS: Array<[RegExp, number]> = [
  [/^(?:h|hrs?|hours?|ore?|ora)$/, 3600],
  [/^(?:m|mins?|minutes?|minuti?|minuto)$/, 60],
  [/^(?:s|secs?|seconds?|secondi?|secondo)$/, 1],
];

const unitSeconds = (word: string): number | null => UNITS.find(([re]) => re.test(word))?.[1] ?? null;

/**
 * Lenient parser for a typed jump, in seconds, or null when it cannot make sense
 * of it:
 *  - a bare number is seconds: "45"
 *  - clock form: "1:30" (1 min 30 s), "1:02:05" (h:mm:ss)
 *  - units, alone or together, each at most once and in any order: "45s", "2m",
 *    "2 min", "1h", "1h30m", "1h30m30s", "90m", "2 ore 5 minuti"
 *  - a number left without a unit after another takes the next smaller one:
 *    "1h30" is 1 h 30 min, "1m30" is 1 min 30 s
 * Zero and more than a day are refused.
 */
export function parseJump(input: string): number | null {
  const t = input.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
    return seconds > 0 && seconds <= MAX_JUMP_SECONDS ? seconds : null;
  }
  if (!/^(?:\s*\d+(?:\.\d+)?\s*[a-z]*)+$/.test(t)) return null;

  const tokens = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)/g)].map((m) => ({ value: Number(m[1]), unit: m[2]! }));
  const used = new Set<number>();
  let total = 0;
  let previous: number | null = null;
  for (const [i, { value, unit }] of tokens.entries()) {
    let factor: number | null;
    if (unit !== '') factor = unitSeconds(unit);
    else if (tokens.length === 1) factor = 1;
    // Only the last number may go without a unit, and only after a bigger one.
    else if (i === tokens.length - 1 && previous !== null && previous > 1) factor = previous === 3600 ? 60 : 1;
    else factor = null;
    if (factor === null || used.has(factor)) return null;
    used.add(factor);
    previous = factor;
    total += value * factor;
  }
  const seconds = Math.round(total);
  return seconds > 0 && seconds <= MAX_JUMP_SECONDS ? seconds : null;
}
