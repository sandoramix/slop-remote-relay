import type { Transport, TransportEvents } from '@relay/protocol';
import { DEFAULT_LAN_PORT } from '@relay/protocol';

export interface LanOptions {
  host: string;
  port?: number;
  priority?: number;
  connectTimeoutMs?: number;
}

/**
 * Direct WebSocket to an Android receiver on the same network.
 *
 * Fastest (single-digit ms), zero infrastructure, and the only remote-less path
 * that keeps working when the internet is down. Falls over the moment the
 * controller leaves the network, which is what every other path is for.
 */
export class LanWebSocketTransport implements Transport {
  readonly id = 'lan';
  readonly label = 'Wi-Fi locale';
  readonly priority: number;
  readonly worksRemotely = false;

  private socket: WebSocket | null = null;

  constructor(private readonly options: LanOptions) {
    this.priority = options.priority ?? 0;
  }

  async connect(events: TransportEvents): Promise<void> {
    const { host, port = DEFAULT_LAN_PORT, connectTimeoutMs = 3000 } = this.options;
    const url = `ws://${host}:${port}/ctl`;
    const socket = new WebSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timeout connecting to ${url}`));
      }, connectTimeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach ${url}`));
      };
    });

    socket.onmessage = (e) => events.onMessage(String(e.data));
    socket.onclose = () => {
      if (this.socket === socket) events.onStateChange('failed', 'socket closed');
    };
    events.onStateChange('connected');
  }

  async send(raw: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('LAN socket not open');
    }
    this.socket.send(raw);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
