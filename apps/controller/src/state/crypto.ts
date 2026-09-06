import CryptoJS from 'crypto-js';

/**
 * HMAC-SHA256 in hex. crypto-js is pure JS, so this works in the RN JS thread
 * with no native module. If you later move to a native crypto lib, this is the
 * only file that changes.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
}

export function uuid(): string {
  // RFC 4122 v4, adequate as an idempotency key.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Pairing code → room id. Both devices derive the same room from the same code. */
export async function roomFromPairCode(code: string): Promise<string> {
  return CryptoJS.SHA256(`room:${code}`).toString(CryptoJS.enc.Hex).slice(0, 24);
}

/** Pairing code → HMAC secret. Separate derivation so the relay cannot forge. */
export async function secretFromPairCode(code: string): Promise<string> {
  return CryptoJS.SHA256(`secret:${code}`).toString(CryptoJS.enc.Hex);
}
