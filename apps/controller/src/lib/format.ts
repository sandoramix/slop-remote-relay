/** 75 → "1:15", 3725 → "1:02:05". Input in seconds. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Chip label for a jump: 10 → "10s", 90 → "1:30", 300 → "5 min", 3600 → "1 h". */
export function jumpLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return clock(seconds);
}

/**
 * Lenient parser for a typed jump: "45", "45s", "2m", "2 min", "1:30",
 * "1:02:05", "1h". Returns seconds, or null when it cannot make sense of it.
 */
export function parseJump(input: string): number | null {
  const t = input.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
    return seconds > 0 ? seconds : null;
  }
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secondi?|m|min|minuti?|h|ore?)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2] ?? 's';
  const factor = unit.startsWith('h') || unit.startsWith('or') ? 3600 : unit.startsWith('m') ? 60 : 1;
  const seconds = Math.round(value * factor);
  return seconds > 0 && seconds <= 86_400 ? seconds : null;
}

const KNOWN: Record<string, string> = {
  'com.google.android.youtube': 'YouTube',
  'com.brave.browser': 'Brave',
  'com.android.chrome': 'Chrome',
  'org.mozilla.firefox': 'Firefox',
  'com.netflix.mediaclient': 'Netflix',
  'com.amazon.avod.thirdpartyclient': 'Prime Video',
  'com.disney.disneyplus': 'Disney+',
  'tv.twitch.android.app': 'Twitch',
  'org.videolan.vlc': 'VLC',
};

/** An Android package or a browser tab URL, as something a person reads. */
export function prettySource(source: string | null | undefined): string | null {
  if (!source) return null;
  if (KNOWN[source]) return KNOWN[source];
  if (/^https?:\/\//.test(source)) {
    try {
      return new URL(source).hostname.replace(/^www\./, '');
    } catch {
      return source;
    }
  }
  const last = source.split('.').pop() ?? source;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export const EXECUTOR_LABEL: Record<string, string> = {
  mediasession: 'MediaSession',
  accessibility: 'Accessibilità',
  shizuku: 'Shizuku',
  settings: 'Impostazioni',
  dom: 'pagina',
  cdp: 'DevTools',
};
