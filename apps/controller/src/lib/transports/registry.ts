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
import { t } from '../i18n';
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
    get label() {
      return t('transport.lan.label');
    },
    get summary() {
      return t('transport.lan.summary');
    },
    kinds: ['android'],
    missing: ({ target }) => (target.lanHost ? null : t('transport.lan.missing')),
    build: ({ target, priority }) =>
      new LanWebSocketTransport({ host: target.lanHost!, priority }),
  },
  webrtc: {
    id: 'webrtc',
    get label() {
      return t('transport.webrtc.label');
    },
    get summary() {
      return t('transport.webrtc.summary');
    },
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : t('transport.webrtc.missing')),
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
    get label() {
      return t('transport.relay.label');
    },
    get summary() {
      return t('transport.relay.summary');
    },
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : t('transport.relay.missing')),
    build: ({ settings, room, priority }) =>
      new RelayWsTransport({ url: settings.relayUrl!, room, role: 'controller', priority }),
  },
  http: {
    id: 'http',
    get label() {
      return t('transport.http.label');
    },
    get summary() {
      return t('transport.http.summary');
    },
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.relayUrl ? null : t('transport.relay.missing')),
    build: ({ settings, room, priority }) =>
      new RelayHttpTransport({ url: settings.relayUrl!, room, role: 'controller', priority }),
  },
  mqtt: {
    id: 'mqtt',
    get label() {
      return t('transport.mqtt.label');
    },
    get summary() {
      return t('transport.mqtt.summary');
    },
    kinds: ['android', 'browser'],
    missing: ({ settings }) => (settings.mqttUrl ? null : t('transport.mqtt.missing')),
    build: ({ settings, room, priority }) =>
      new MqttTransport({ url: settings.mqttUrl, room, role: 'controller', priority }),
  },
  ble: {
    id: 'ble',
    get label() {
      return t('transport.ble.label');
    },
    get summary() {
      return t('transport.ble.summary');
    },
    kinds: ['android'],
    missing: ({ target }) => (target.bleDeviceId ? null : t('transport.ble.missing')),
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
    if (!isEnabled(ctx.settings, id)) skipped = t('transport.disabled');
    else if (!meta.kinds.includes(ctx.target.kind)) {
      skipped = ctx.target.kind === 'browser' ? t('transport.unavailableBrowser') : t('transport.unavailable');
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
