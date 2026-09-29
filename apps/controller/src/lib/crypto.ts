import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';

/**
 * Pure-JS hashing, so signing never waits on a native bridge call: a button
 * press signs one envelope and sends it, and a few microseconds of JS beats a
 * round trip to native. The derivations must match Codec.kt byte for byte.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message)));
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/** Pairing code → HMAC secret. Separate derivation so the relay cannot forge. */
export const secretFromPairCode = (code: string): string => sha256Hex(`secret:${code}`);

/** Pairing code → room id. Both devices derive the same room from the same code. */
export const roomFromPairCode = (code: string): string => sha256Hex(`room:${code}`).slice(0, 24);

/**
 * Room → 8-byte tag the receiver advertises over BLE, so the controller can
 * pick its own receiver out of a scan. Hashed again so the broadcast can't be
 * matched to the room id a relay sees. Same as Codec.bleTagFromRoom.
 */
export const bleTagFromRoom = (room: string): string => sha256Hex(`ble:${room}`).slice(0, 16);

/** RFC 4122 v4 from the platform CSPRNG. The receiver's idempotency key. */
export const uuid = (): string => Crypto.randomUUID();

// 32 symbols, no 0/O or 1/L: the code gets read off one screen and typed on another.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * A pair code with 80 bits of entropy, as four groups of four.
 *
 * It has to be long. The room id is a plain hash of the code, and whoever runs
 * the relay — or anyone watching a public MQTT broker — sees room ids. A short
 * or dictionary code can be brute-forced offline from one, and the HMAC secret
 * then follows from the same code. Eighty bits puts that out of reach.
 */
export function generatePairCode(): string {
  const bytes = Crypto.getRandomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[bytes[i]! % 32];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

/** Rough strength of a user-typed code, for the warning under the field. */
export function pairCodeIsWeak(code: string): boolean {
  return code.replace(/[^a-z0-9]/gi, '').length < 12;
}
