import type { Transport, TransportEvents } from '@relay/protocol';
import { DEFAULT_LAN_PORT } from '@relay/protocol';

export interface LanOptions {
  /** Resolved host. Leave null to let the manager wait for discovery. */
  host: string | null;
  port?: number;
  connectTimeoutMs?: number;
}

/**
 * Path 1 — direct WebSocket to the receiver on the same network.
 *
 * Fastest (single-digit ms), zero infrastructure, and the only one that keeps
 * working when the internet is down. Falls over the moment the controller leaves
 * the network, which is exactly what the relay path is for.
 */
export class LanWebSocketTransport implements Transport {
  readonly id = 'lan';
  readonly label = 'Wi-Fi locale';
  readonly priority = 0;
  readonly worksRemotely = false;

  private socket: WebSocket | null = null;

  constructor(private readonly options: LanOptions) {}

  async connect(events: TransportEvents): Promise<void> {
    const { host, port = DEFAULT_LAN_PORT, connectTimeoutMs = 3000 } = this.options;
    if (!host) throw new Error('No receiver discovered on this network yet');

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
        events.onStateChange('connected');
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach ${url}`));
      };
    });

    socket.onmessage = (e) => events.onMessage(String(e.data));
    socket.onclose = () => events.onStateChange('failed', 'socket closed');
  }

  async send(raw: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('LAN socket not open');
    }
    this.socket.send(raw);
  }

  async close(): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * NSD/mDNS discovery. Wraps react-native-zeroconf so the rest of the app never
 * imports a native module directly — swap the library and only this file changes.
 *
 * Wire it up in App.tsx: run `discoverReceiver` once at startup and pass the
 * resolved host into LanWebSocketTransport.
 */
export async function discoverReceiver(timeoutMs = 4000): Promise<string | null> {
  try {
    // Lazy import: on a controller with no zeroconf module installed we simply
    // fall back to a manually configured host instead of crashing at import time.
    const { default: Zeroconf } = await import('react-native-zeroconf');
    const zeroconf = new Zeroconf();

    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        zeroconf.stop();
        resolve(null);
      }, timeoutMs);

      zeroconf.on('resolved', (service: { addresses?: string[] }) => {
        const address = service.addresses?.find((a) => !a.includes(':'));
        if (address) {
          clearTimeout(timer);
          zeroconf.stop();
          resolve(address);
        }
      });

      zeroconf.scan('relayctl', 'tcp', 'local.');
    });
  } catch {
    return null;
  }
}
