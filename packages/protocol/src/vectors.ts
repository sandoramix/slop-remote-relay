import { canonicalize } from './codec';
import { CommandEnvelope, PROTOCOL_VERSION } from './messages';

/**
 * Reference vectors for the canonical form.
 *
 * The Kotlin Codec.canonicalize must produce byte-identical output for these, or
 * every signature will fail with no useful error message. Run `npm run vectors`
 * here, paste the output into CodecTest.kt on the Android side, and you will
 * catch serialisation drift the moment it happens instead of at 2am on a sofa.
 */
export const VECTORS: Array<{ name: string; input: CommandEnvelope }> = [
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
];

declare const process: { env: Record<string, string | undefined> } | undefined;

if (typeof process !== 'undefined' && process.env.PRINT_VECTORS) {
  for (const v of VECTORS) {
    console.log(`${v.name}\n  ${canonicalize(v.input)}\n`);
  }
}
