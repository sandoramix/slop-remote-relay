import type { Transport, TransportEvents } from '@relay/protocol';
import { openSocket, RoomOptions, trimBase } from './common';

export interface RelayWsOptions extends RoomOptions {
  /** ws://host:8080 or wss://relay.example.com */
  url: string;
  connectTimeoutMs?: number;
}

/**
 * Remote relay over WebSocket.
 *
 * A rendezvous server that forwards opaque frames between the members of a
 * room. It cannot forge commands: the HMAC is computed with a secret the relay
 * never holds, only the room id reaches it.
 *
 * `ch=ws` tells the relay which channel this is, so a frame that arrives on the
 * WebSocket is delivered to the peer's WebSocket too when it has one. That keeps
 * this path and the HTTP fallback independent even though they share a server.
 */
export class RelayWsTransport implements Transport {
  readonly id = 'relay';
  readonly label = 'Relay remoto';
  readonly priority: number;
  readonly worksRemotely = true;

  private socket: WebSocket | null = null;

  constructor(private readonly options: RelayWsOptions) {
    this.priority = options.priority ?? 10;
  }

  async connect(events: TransportEvents): Promise<void> {
    const { url, room, role, connectTimeoutMs = 6000 } = this.options;
    const target = `${trimBase(url)}/room/${encodeURIComponent(room)}?role=${role}&ch=ws`;
    const socket = await openSocket(target, connectTimeoutMs);
    this.socket = socket;
    socket.onmessage = (e) => events.onMessage(String(e.data));
    socket.onclose = (e) => {
      if (this.socket === socket) events.onStateChange('failed', `relay closed (${e.code})`);
    };
    events.onStateChange('connected');
  }

  async send(raw: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay socket not open');
    }
    this.socket.send(raw);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
