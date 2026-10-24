/**
 * The extension's own log: what it did, kept in the browser so it can be sent
 * to the developer. Same idea as the apps' logs.
 *
 * The worker and the offscreen document each write their own storage key
 * (`log.worker`, `log.offscreen`), so two contexts never overwrite each other;
 * the popup merges them by time. Lines keep the newest MAX_LINES per context.
 * What identifies a pairing is registered with `hideFromLog` and replaced in
 * every line, so a log can be pasted into a public issue.
 */

export type LogContext = 'worker' | 'offscreen';

const MAX_LINES = 400;
const SAVE_AFTER_MS = 800;
const MASK = '‹hidden›';
const keyOf = (context: LogContext) => `log.${context}`;

let context: LogContext | null = null;
let lines: string[] = [];
let hidden: string[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready: Promise<void> = Promise.resolve();

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function stamp(date = new Date()): string {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export const scrub = (text: string, secrets: string[] = hidden) =>
  secrets.reduce((acc, secret) => acc.split(secret).join(MASK), text);

/** Call once per context; earlier lines (a worker the browser put to sleep) come back from storage. */
export function initLog(which: LogContext): void {
  if (context) return;
  context = which;
  ready = chrome.storage.local
    .get(keyOf(which))
    .then((stored) => {
      const saved = stored[keyOf(which)] as string[] | undefined;
      if (saved) lines = [...saved, ...lines].slice(-MAX_LINES);
    })
    .catch(() => undefined);
}

function save(now: boolean) {
  if (!context) return;
  if (now && saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveTimer) return;
  const flush = () => {
    saveTimer = null;
    void ready.then(() => chrome.storage.local.set({ [keyOf(context!)]: lines })).catch(() => undefined);
  };
  if (now) flush();
  else saveTimer = setTimeout(flush, SAVE_AFTER_MS);
}

function write(level: 'D' | 'I' | 'W' | 'E', tag: string, message: string) {
  lines.push(`${stamp()} ${level}/${tag}: ${scrub(message)}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  // A worker can be stopped at any moment: warnings and errors are written at once.
  save(level === 'W' || level === 'E');
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

/** Errors nobody caught, in this context, end up in the log. */
export function captureErrors(tag: string): void {
  self.addEventListener('error', (e) => log.e(tag, `uncaught: ${e.message}`));
  self.addEventListener('unhandledrejection', (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    log.e(tag, `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

/** The popup's side: both contexts' lines merged by time, with the pair code taken out again. */
export async function readLog(secrets: string[] = []): Promise<string> {
  const stored = await chrome.storage.local.get([keyOf('worker'), keyOf('offscreen')]);
  const all = ([] as string[]).concat(
    (stored[keyOf('worker')] as string[] | undefined) ?? [],
    (stored[keyOf('offscreen')] as string[] | undefined) ?? [],
  );
  // Every line starts with a fixed-width "MM-DD HH:MM:SS.mmm", so a plain sort is a time sort.
  return scrub(all.sort().join('\n'), secrets.filter((s) => s.length >= 4));
}

export async function clearLog(): Promise<void> {
  lines = [];
  await chrome.storage.local.remove([keyOf('worker'), keyOf('offscreen')]);
}
