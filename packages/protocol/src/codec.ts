import {
  Envelope,
  PROTOCOL_VERSION,
  SKEW_TOLERANCE_MS,
} from './messages';

/**
 * Canonical serialization. Both sides must produce byte-identical output for the
 * same logical message or the HMAC will not match — hence the explicit key sort
 * and the exclusion of `sig` itself. Kotlin mirrors this in Codec.kt.
 */
export function canonicalize(env: Omit<Envelope, 'sig'> & { sig?: string }): string {
  const { sig: _drop, ...body } = env as Record<string, unknown> & { sig?: string };
  return stableStringify(body);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export interface Signer {
  /** Returns a lowercase hex HMAC-SHA256 digest. */
  hmac(message: string): Promise<string>;
}

export async function sign<T extends Envelope>(env: T, signer: Signer): Promise<T> {
  const sig = await signer.hmac(canonicalize(env));
  return { ...env, sig };
}

export type VerifyResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; reason: 'malformed' | 'version' | 'signature' | 'skew' };

export async function decodeAndVerify(
  raw: string,
  signer: Signer,
  now: number = Date.now(),
): Promise<VerifyResult> {
  let parsed: Envelope;
  try {
    parsed = JSON.parse(raw) as Envelope;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.type) {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'version' };
  }
  if (Math.abs(now - parsed.ts) > SKEW_TOLERANCE_MS) {
    return { ok: false, reason: 'skew' };
  }

  // `hello` is unsigned by definition: it is what establishes the session.
  if (parsed.type !== 'hello') {
    const expected = await signer.hmac(canonicalize(parsed));
    if (!parsed.sig || !constantTimeEquals(parsed.sig, expected)) {
      return { ok: false, reason: 'signature' };
    }
  }

  return { ok: true, envelope: parsed };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fixed-size ring buffer of seen message ids. The dedupe that makes mirroring safe. */
export class DedupeWindow {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity: number) {}

  /** Returns true if this id is new (and records it), false if already seen. */
  admit(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted) this.seen.delete(evicted);
    }
    return true;
  }
}
