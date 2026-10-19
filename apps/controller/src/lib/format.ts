import { t } from './i18n';

// Jump amounts are written and read by the same code as in the browser
// extension's skip panel; see packages/protocol/src/jump.ts.
export { clock, jumpLabel, parseJump } from '@relay/protocol';

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

/** What ran a command, as a person reads it; unknown ids are shown as they came. */
export function executorLabel(id: string): string {
  switch (id) {
    case 'mediasession':
      return 'MediaSession';
    case 'accessibility':
      return t('exec.accessibility');
    case 'shizuku':
      return 'Shizuku';
    case 'settings':
      return t('exec.settings');
    case 'dom':
      return t('exec.dom');
    case 'cdp':
      return 'DevTools';
    default:
      return id;
  }
}
