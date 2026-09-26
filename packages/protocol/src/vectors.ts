import { canonicalize } from './codec';
import { Envelope, PROTOCOL_VERSION } from './messages';

/**
 * Reference vectors for the canonical form and for the signing path built on it.
 *
 * The Kotlin Codec must produce byte-identical output for these, or every
 * signature will fail with no useful error message. Run `npm run vectors` here,
 * paste the output into CodecTest.kt on the Android side, and you will catch
 * drift the moment it happens instead of at 2am on a sofa.
 *
 * The escaping group exists because the first version of this file did not have
 * it. Every vector was a tidy ASCII envelope, so the Kotlin side could sit on
 * JSONObject.quote — which escapes '/' where JSON.stringify does not — and the
 * test stayed green while the device would have rejected any ack whose detail
 * mentioned a URL. When adding a vector, prefer an ugly string to a pretty one.
 */
export const VECTORS: Array<{ name: string; input: Envelope }> = [
  {
    name: 'seek forward',
    input: {
      v: PROTOCOL_VERSION,
      id: '11111111-2222-4333-8444-555555555555',
      ts: 1757030400000,
      type: 'cmd',
      cmd: { op: 'playback.seek', deltaMs: 30000 },
      critical: true,
    },
  },
  {
    name: 'fullscreen toggle',
    input: {
      v: PROTOCOL_VERSION,
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ts: 1757030400000,
      type: 'cmd',
      cmd: { op: 'fullscreen.enter', toggle: true },
    },
  },
  {
    name: 'negative seek, no critical flag',
    input: {
      v: PROTOCOL_VERSION,
      id: '00000000-0000-4000-8000-000000000000',
      ts: 1757030400000,
      type: 'cmd',
      cmd: { op: 'playback.seek', deltaMs: -10000 },
    },
  },

  // ---------------------------------------------------------------- escaping

  {
    name: 'ack detail with a slash',
    input: {
      v: PROTOCOL_VERSION,
      id: '11111111-1111-4111-8111-111111111111',
      ts: 1757030400000,
      type: 'ack',
      ref: '00000000-0000-4000-8000-000000000000',
      ok: true,
      executedBy: 'mediasession',
      // The '</' matters: the Maven org.json behind the JVM unit tests escapes
      // a slash that follows '<', so this is the one slash case a JVM test can
      // actually catch. AOSP escapes every slash, which no JVM test can see —
      // hence the Kotlin side owning its own escaper.
      detail: 'seekTo 61000ms on com.google.android.youtube via wss://relay/room/x </end>',
      tookMs: 12,
    },
  },
  {
    name: 'ack detail with quotes, backslashes and control characters',
    input: {
      v: PROTOCOL_VERSION,
      id: '22222222-2222-4222-8222-222222222222',
      ts: 1757030400000,
      type: 'ack',
      ref: '00000000-0000-4000-8000-000000000000',
      ok: false,
      detail: 'no "fullscreen" node\tin C:\\Users\\x\nline two\u0001\u001f',
      tookMs: 3,
    },
  },
  {
    name: 'event with non-ascii and astral characters',
    input: {
      v: PROTOCOL_VERSION,
      id: '33333333-3333-4333-8333-333333333333',
      ts: 1757030400000,
      type: 'event',
      event: 'error',
      // Accented Italian, a CJK glyph and an emoji. The emoji is a surrogate
      // pair, which JSON.stringify emits raw and a naive escaper mangles.
      detail: 'perch\u00e9 nessuna strategia ha funzionato \u2014 \u5168\u753b\u9762 \ud83c\udfac',
    },
  },
  {
    name: 'status event with nulls and an array',
    input: {
      v: PROTOCOL_VERSION,
      id: '44444444-4444-4444-8444-444444444444',
      ts: 1757030400000,
      type: 'event',
      event: 'status',
      status: {
        foregroundPackage: null,
        hasMediaSession: false,
        positionMs: null,
        durationMs: null,
        isPlaying: false,
        executors: ['mediasession', 'accessibility'],
        recipeKnown: false,
        batteryPercent: 87,
      },
    },
  },

  // ------------------------------------------------------ added with v0.2 ops

  {
    name: 'fullscreen exit',
    input: {
      v: PROTOCOL_VERSION,
      id: '55555555-5555-4555-8555-555555555555',
      ts: 1757030400000,
      type: 'cmd',
      cmd: { op: 'fullscreen.exit' },
    },
  },
  {
    name: 'absolute seek past the 32-bit range',
    input: {
      v: PROTOCOL_VERSION,
      id: '66666666-6666-4666-8666-666666666666',
      ts: 1757030400000,
      type: 'cmd',
      // Longer than Int.MAX_VALUE ms is absurd for a video, but it proves the
      // Kotlin side reads positions as Long rather than truncating to Int.
      cmd: { op: 'playback.seekTo', positionMs: 3000000000 },
      critical: true,
    },
  },
  {
    name: 'browser status with title and fullscreen',
    input: {
      v: PROTOCOL_VERSION,
      id: '77777777-7777-4777-8777-777777777777',
      ts: 1757030400000,
      type: 'event',
      event: 'status',
      status: {
        foregroundPackage: 'https://www.youtube.com/watch?v=x',
        hasMediaSession: true,
        positionMs: 61000,
        durationMs: 3600000,
        isPlaying: true,
        executors: ['dom', 'cdp'],
        recipeKnown: true,
        batteryPercent: null,
        kind: 'browser',
        title: 'Un "titolo" / con — accenti è',
        fullscreen: false,
      },
    },
  },
];

/** The pairing code the derivation vectors below are computed from. */
export const SAMPLE_PAIR_CODE = 'cielo-lento-42';

// --------------------------------------------------------------------------
// Runner
// --------------------------------------------------------------------------

// This package has no @types/node on purpose — it is imported by React Native.
// These are the few host globals the vector printer needs.
declare const process: { env: Record<string, string | undefined> } | undefined;
declare const console: { log(...args: unknown[]): void };
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };
declare const crypto: {
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
    importKey(
      format: string,
      keyData: Uint8Array,
      algorithm: { name: string; hash: string },
      extractable: boolean,
      usages: string[],
    ): Promise<unknown>;
    sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  };
};

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

async function sha256Hex(input: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes(input)));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, bytes(message)));
}

/**
 * Printed unconditionally: nothing imports this module for its side effects, it
 * is only ever run directly. The previous env-var guard used a POSIX `VAR=1 cmd`
 * prefix in the npm script, which is a syntax error on Windows.
 */
async function main(): Promise<void> {
  console.log('# canonical form\n');
  for (const v of VECTORS) {
    console.log(`${v.name}\n  ${canonicalize(v.input)}\n`);
  }

  console.log('# derivations and signature, pair code ' + JSON.stringify(SAMPLE_PAIR_CODE) + '\n');
  const secret = await sha256Hex(`secret:${SAMPLE_PAIR_CODE}`);
  const room = (await sha256Hex(`room:${SAMPLE_PAIR_CODE}`)).slice(0, 24);
  console.log(`secretFromPairCode\n  ${secret}\n`);
  console.log(`roomFromPairCode\n  ${room}\n`);

  const first = VECTORS[0];
  if (first) {
    const sig = await hmacSha256Hex(secret, canonicalize(first.input));
    console.log(`hmac over "${first.name}"\n  ${sig}\n`);
  }
}

if (typeof process !== 'undefined') {
  void main();
}
