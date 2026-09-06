import type { Transport, TransportEvents } from '@relay/protocol';

export interface RelayOptions {
  /** wss://relay.example.com */
  url: string;
  /** Pairing room id — both devices join the same one. Derived from the pair code. */
  room: string;
  connectTimeoutMs?: number;
}

/**
 * Path 2 — remote relay over WebSocket.
 *
 * A rendezvous server that forwards opaque frames between the two members of a
 * room. It never sees plaintext commands beyond the JSON envelope, and it cannot
 * forge them: the HMAC is computed with a secret the relay does not hold.
 *
 * This is the pragmatic answer to "remote P2P". True serverless P2P does not
 * exist on the public internet — WebRTC still needs signalling, and on mobile
 * carrier NAT it usually ends up relayed through TURN anyway. If you later want
 * genuine media-grade P2P, add a WebRtcTransport alongside this one at priority
 * 5 and this file keeps working as the fallback beneath it.
 */
export class RelayTransport implements Transport {
  readonly id = 'relay';
  readonly label = 'Relay remoto';
  readonly priority = 10;
  readonly worksRemotely = true;

  private socket: WebSocket | null = null;

  constructor(private readonly options: RelayOptions) {}

  async connect(events: TransportEvents): Promise<void> {
    const { url, room, connectTimeoutMs = 6000 } = this.options;
    const target = `${url.replace(/\/$/, '')}/room/${encodeURIComponent(room)}?role=controller`;
    const socket = new WebSocket(target);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timeout connecting to relay`));
      }, connectTimeoutMs);

      socket.onopen = () => {
        clearTimeout(timer);
        events.onStateChange('connected');
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Relay unreachable'));
      };
    });

    socket.onmessage = (e) => events.onMessage(String(e.data));
    socket.onclose = (e) =>
      events.onStateChange('failed', `relay closed (${e.code})`);
  }

  async send(raw: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay socket not open');
    }
    this.socket.send(raw);
  }

  async close(): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }
}
