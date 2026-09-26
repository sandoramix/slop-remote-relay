import { utf8Decode, utf8Encode } from './common';

/**
 * The slice of MQTT 3.1.1 this project needs, and nothing more: CONNECT,
 * SUBSCRIBE, PUBLISH at QoS 0, PINGREQ and DISCONNECT out; CONNACK, SUBACK,
 * PUBLISH and PINGRESP in.
 *
 * Why not mqtt.js: it drags Node's stream, buffer and url into a React Native
 * bundle and a Manifest V3 extension, for a protocol whose whole wire format for
 * this use fits on one screen. QoS 0 is enough because reliability already
 * lives a layer up: every command is acked, retried by the user, and deduped by
 * id on the receiver. Kotlin mirrors this in transport/MqttCodec.kt.
 */

export const enum PacketType {
  CONNECT = 1,
  CONNACK = 2,
  PUBLISH = 3,
  SUBSCRIBE = 8,
  SUBACK = 9,
  PINGREQ = 12,
  PINGRESP = 13,
  DISCONNECT = 14,
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function str(s: string): number[] {
  const b = utf8Encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}

function packet(header: number, body: number[]): Uint8Array {
  return Uint8Array.from([header, ...remainingLength(body.length), ...body]);
}

export function connect(clientId: string, keepAliveSec: number): Uint8Array {
  return packet(0x10, [
    ...str('MQTT'),
    4, // protocol level 3.1.1
    0x02, // clean session, no auth, no will
    keepAliveSec >> 8,
    keepAliveSec & 0xff,
    ...str(clientId),
  ]);
}

export function subscribe(packetId: number, topic: string): Uint8Array {
  return packet(0x82, [packetId >> 8, packetId & 0xff, ...str(topic), 0]);
}

export function publish(topic: string, payload: string): Uint8Array {
  return packet(0x30, [...str(topic), ...utf8Encode(payload)]);
}

export const pingreq = (): Uint8Array => Uint8Array.from([0xc0, 0]);
export const disconnect = (): Uint8Array => Uint8Array.from([0xe0, 0]);

export type Incoming =
  | { type: PacketType.CONNACK; returnCode: number }
  | { type: PacketType.SUBACK; granted: number }
  | { type: PacketType.PUBLISH; topic: string; payload: string }
  | { type: PacketType.PINGRESP }
  | { type: 'other'; code: number };

/**
 * Stream parser. MQTT over WebSocket may split one packet across several
 * WebSocket messages or pack several into one, so bytes accumulate here and
 * complete packets come out.
 */
export class MqttParser {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Incoming[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const out: Incoming[] = [];
    for (;;) {
      const parsed = this.next();
      if (!parsed) break;
      out.push(parsed);
    }
    return out;
  }

  private next(): Incoming | null {
    const b = this.buffer;
    if (b.length < 2) return null;

    let length = 0;
    let multiplier = 1;
    let i = 1;
    for (;;) {
      if (i >= b.length) return null;
      const byte = b[i++]!;
      length += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) break;
      multiplier *= 128;
      if (i > 4) throw new Error('malformed remaining length');
    }
    if (b.length < i + length) return null;

    const header = b[0]!;
    const body = b.subarray(i, i + length);
    this.buffer = b.slice(i + length);

    const type = header >> 4;
    switch (type) {
      case PacketType.CONNACK:
        return { type: PacketType.CONNACK, returnCode: body[1] ?? 255 };
      case PacketType.SUBACK:
        return { type: PacketType.SUBACK, granted: body[2] ?? 0x80 };
      case PacketType.PINGRESP:
        return { type: PacketType.PINGRESP };
      case PacketType.PUBLISH: {
        const qos = (header >> 1) & 3;
        const topicLength = (body[0]! << 8) | body[1]!;
        const topic = utf8Decode(body.subarray(2, 2 + topicLength));
        // QoS > 0 carries a packet id after the topic. We only subscribe at 0,
        // but a broker may still deliver a retained message at a higher QoS.
        const start = 2 + topicLength + (qos > 0 ? 2 : 0);
        return { type: PacketType.PUBLISH, topic, payload: utf8Decode(body.subarray(start)) };
      }
      default:
        return { type: 'other', code: type };
    }
  }
}
