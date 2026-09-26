import type { ReceiverKind, Transport, TransportId } from '@relay/protocol';
import {
  MqttTransport,
  RelayHttpTransport,
  RelayWsTransport,
  WebRtcTransport,
  type PeerConnectionFactory,
} from '@relay/transports';
import { RTCPeerConnection } from 'react-native-webrtc';
import type { Settings, Target } from '../../state/settings';
import { isEnabled, normalizeOrder } from '../../state/settings';
import { BleTransport } from './ble';
import { LanWebSocketTransport } from './lan';

/** Everything a transport may need to build itself. */
export interface BuildContext {
  target: Target;
  settings: Settings;
  room: string;
  hmac: (message: string) => Promise<string>;
  priority: number;
}

export interface TransportMeta {
  id: TransportId;
  label: string;
  /** One line under the name in the ordering screen. */
  summary: string;
  /** Which receivers can be reached this way at all. */
  kinds: ReceiverKind[];
  /** Null when the path cannot be built yet, with the reason for the UI. */
  missing: (ctx: Omit<BuildContext, 'priority'>) => string | null;
  build: (ctx: BuildContext) => Transport;
}

const createPeerConnection: PeerConnectionFactory = (config) =>
  new RTCPeerConnection(config) as unknown as ReturnType<PeerConnectionFactory>;

/**
 * The transport registry. Adding a path is one class and one entry here;
 * commands, UI and the receiver's execution chain never learn which path a
 * frame took. The user's order in settings — not the position in this list —
 * decides which is tried first.
 */
export const TRANSPORTS: Record<TransportId, TransportMeta> = {
  lan: {
    id: 'lan',
    label: 'Wi-Fi locale',
    summary: 'Diretto sulla stessa rete. Il più veloce, funziona senza internet.',
    kinds: ['android'],
    missing: ({ target }) => (target.lanHost ? null : 'Indirizzo locale non impostato'),
    build: ({ target, priority }) =>
      new LanWebSocketTransport({ host: target.lanHost!, priority }),
  },
  webrtc: {
    id: 'webrtc',
    label: 'WebRTC P2P',
    summary: 'Diretto fra i dispositivi via internet. Il relay serve solo ad aprirlo.',
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : 'Serve il server relay per la segnalazione'),
    build: ({ settings, room, hmac, priority }) =>
      new WebRtcTransport({
        signalUrl: settings.relayUrl!,
        room,
        role: 'controller',
        createPeerConnection,
        hmac,
        stunUrls: settings.stunUrls,
        turn: settings.turn,
        priority,
      }),
  },
  relay: {
    id: 'relay',
    label: 'Relay remoto',
    summary: 'Attraverso il tuo server relay, via WebSocket. Funziona ovunque.',
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : 'Server relay non impostato'),
    build: ({ settings, room, priority }) =>
      new RelayWsTransport({ url: settings.relayUrl!, room, role: 'controller', priority }),
  },
  http: {
    id: 'http',
    label: 'Relay HTTP',
    summary: 'Stesso server, ma in HTTP semplice: passa dove i WebSocket sono bloccati.',
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : 'Server relay non impostato'),
    build: ({ settings, room, priority }) =>
      new RelayHttpTransport({ url: settings.relayUrl!, room, role: 'controller', priority }),
  },
  mqtt: {
    id: 'mqtt',
    label: 'MQTT',
    summary: 'Attraverso un broker MQTT: resta in piedi anche se il tuo relay è giù.',
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.mqttUrl ? null : 'Broker MQTT non impostato'),
    build: ({ settings, room, priority }) =>
      new MqttTransport({ url: settings.mqttUrl, room, role: 'controller', priority }),
  },
  ble: {
    id: 'ble',
    label: 'Bluetooth',
    summary: 'Nessuna rete necessaria, a pochi metri dal ricevitore.',
    kinds: ['android'],
    missing: ({ target }) => (target.bleDeviceId ? null : 'Nessun ricevitore Bluetooth associato'),
    build: ({ target, priority }) => new BleTransport(target.bleDeviceId!, priority),
  },
};

export interface PlannedTransport {
  meta: TransportMeta;
  /** Why this path will not run for the current target, or null if it will. */
  skipped: string | null;
}

/** The user's order annotated with what will actually run for this target. */
export function plan(ctx: Omit<BuildContext, 'priority'>): PlannedTransport[] {
  return normalizeOrder(ctx.settings.transportOrder).map((id) => {
    const meta = TRANSPORTS[id];
    let skipped: string | null = null;
    if (!isEnabled(ctx.settings, id)) skipped = 'Disattivato';
    else if (!meta.kinds.includes(ctx.target.kind)) {
      skipped = ctx.target.kind === 'browser' ? 'Non disponibile per il browser' : 'Non disponibile';
    } else skipped = meta.missing(ctx);
    return { meta, skipped };
  });
}

/** The candidate list for TransportManager: runnable paths, priority = rank. */
export function buildTransports(ctx: Omit<BuildContext, 'priority'>): Transport[] {
  return plan(ctx)
    .filter((p) => p.skipped === null)
    .map((p, rank) => p.meta.build({ ...ctx, priority: rank * 10 }));
}
