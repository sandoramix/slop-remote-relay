/**
 * Pieces every room-based transport shares.
 *
 * "Room-based" means both ends meet at a rendezvous keyed by the room id derived
 * from the pair code — the relay server, an MQTT broker, or the relay again for
 * WebRTC signalling. Unlike LAN and BLE, nothing here is asymmetric: the same
 * class serves the controller and a receiver, and only `role` differs.
 */

export type Role = 'controller' | 'receiver';

export const peerOf = (role: Role): Role => (role === 'controller' ? 'receiver' : 'controller');

export interface RoomOptions {
  /** Room id from roomFromPairCode. The only thing the rendezvous ever learns. */
  room: string;
  role: Role;
  /** Rank in the controller's failover order. Lower is preferred. */
  priority?: number;
}

/** Waits for a WebSocket to open, or rejects after `ms`. */
export function openSocket(
  url: string,
  ms: number,
  protocols?: string | string[],
): Promise<WebSocket> {
  const socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timeout (${ms} ms)`));
    }, ms);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('unreachable'));
    };
  });
}

/** Strips trailing slashes so `${base}/room/...` never doubles one. */
export const trimBase = (url: string): string => url.replace(/\/+$/, '');

/** ws(s):// → http(s)://, for the HTTP fallback that shares the relay's host. */
export const httpBase = (relayUrl: string): string =>
  trimBase(relayUrl).replace(/^ws(s?):\/\//i, 'http$1://');

export function randomId(bytes = 8): string {
  let out = '';
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

// UTF-8 without TextDecoder: Hermes ships TextEncoder but not a decoder on
// every React Native version this package has to run on.

export function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++]!;
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 31) << 6) | (b[i++]! & 63);
    else if (c < 0xf0) cp = ((c & 15) << 12) | ((b[i++]! & 63) << 6) | (b[i++]! & 63);
    else
      cp =
        ((c & 7) << 18) | ((b[i++]! & 63) << 12) | ((b[i++]! & 63) << 6) | (b[i++]! & 63);
    out += String.fromCodePoint(cp);
  }
  return out;
}
