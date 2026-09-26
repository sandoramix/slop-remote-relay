import type { Transport, TransportEvents } from '@relay/protocol';
import { DEFAULT_MQTT_URL, MQTT_TOPIC_PREFIX } from '@relay/protocol';
import { peerOf, randomId, RoomOptions } from './common';
import * as mqtt from './mqttCodec';

export interface MqttOptions extends RoomOptions {
  /** Broker WebSocket endpoint, e.g. wss://broker.hivemq.com:8884/mqtt */
  url?: string;
  keepAliveSec?: number;
  connectTimeoutMs?: number;
}

/**
 * Remote path through an MQTT broker instead of our own relay.
 *
 * The point is independence: when the relay server is down, unreachable or
 * blocked, a broker run by someone else — or a mosquitto on a NAS — still gets
 * frames across. Each side subscribes to `relayctl/<room>/<own role>` and
 * publishes to the peer's topic.
 *
 * A public broker is acceptable because every frame is HMAC-signed with a key
 * the broker never sees: it can read traffic but cannot forge or replay it.
 */
export class MqttTransport implements Transport {
  readonly id = 'mqtt';
  readonly label = 'MQTT';
  readonly priority: number;
  readonly worksRemotely = true;

  private socket: WebSocket | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: MqttOptions) {
    this.priority = options.priority ?? 15;
  }

  private topic(role: string): string {
    return `${MQTT_TOPIC_PREFIX}/${this.options.room}/${role}`;
  }

  async connect(events: TransportEvents): Promise<void> {
    const {
      url = DEFAULT_MQTT_URL,
      role,
      keepAliveSec = 30,
      connectTimeoutMs = 8000,
    } = this.options;

    const socket = new WebSocket(url, 'mqtt');
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const parser = new mqtt.MqttParser();
    const inbox = this.topic(role);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`MQTT timeout (${connectTimeoutMs} ms)`));
      }, connectTimeoutMs);
      const fail = (reason: string) => {
        clearTimeout(timer);
        socket.close();
        reject(new Error(reason));
      };

      socket.onerror = () => fail('MQTT broker unreachable');
      socket.onopen = () => {
        socket.send(mqtt.connect(`relay-${role}-${randomId(4)}`, keepAliveSec));
      };
      socket.onmessage = (e) => {
        for (const p of parser.push(new Uint8Array(e.data as ArrayBuffer))) {
          if (p.type === mqtt.PacketType.CONNACK) {
            if (p.returnCode !== 0) return fail(`MQTT refused (${p.returnCode})`);
            socket.send(mqtt.subscribe(1, inbox));
          } else if (p.type === mqtt.PacketType.SUBACK) {
            if (p.granted === 0x80) return fail('MQTT subscribe refused');
            clearTimeout(timer);
            resolve();
          }
        }
      };
    });

    socket.onmessage = (e) => {
      for (const p of parser.push(new Uint8Array(e.data as ArrayBuffer))) {
        if (p.type === mqtt.PacketType.PUBLISH && p.topic === inbox) events.onMessage(p.payload);
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) events.onStateChange('failed', 'MQTT closed');
    };

    // The broker drops a client that stays silent past 1.5× keep-alive.
    this.keepAlive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(mqtt.pingreq());
    }, (keepAliveSec * 1000) / 2);

    events.onStateChange('connected');
  }

  async send(raw: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('MQTT not connected');
    }
    this.socket.send(mqtt.publish(this.topic(peerOf(this.options.role)), raw));
  }

  async close(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(mqtt.disconnect());
    socket?.close();
  }
}
