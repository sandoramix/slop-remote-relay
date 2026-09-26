/**
 * Wire protocol shared by the controller (TypeScript) and the receiver (Kotlin).
 *
 * Design rules that the rest of the system depends on:
 *  1. Every message is a self-contained JSON object. No streaming, no framing games.
 *  2. Every message carries a unique `id`. The receiver keeps a dedupe window keyed
 *     on `id`, which is what makes it safe to send the same command over two
 *     transports at once during a failover.
 *  3. Every message is signed with HMAC-SHA256 over the canonical body using the
 *     pairing secret. A WebSocket server sitting on a LAN is otherwise wide open.
 *  4. `v` is bumped only on breaking changes. The receiver rejects unknown majors.
 */

export const PROTOCOL_VERSION = 1 as const;

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

/** Enter fullscreen on whatever is in the foreground and supports it. */
export interface FullscreenCommand {
  op: 'fullscreen.enter';
  /** If the target is already fullscreen, exit instead of no-op. */
  toggle?: boolean;
}

/** Leave fullscreen on whatever is in the foreground. */
export interface FullscreenExitCommand {
  op: 'fullscreen.exit';
}

/** Move playback by a relative amount. Negative rewinds. */
export interface SeekCommand {
  op: 'playback.seek';
  deltaMs: number;
}

/** Jump to an absolute position. Driven by the scrub bar on the dashboard. */
export interface SeekToCommand {
  op: 'playback.seekTo';
  positionMs: number;
}

/** Toggle play/pause on the active media session. */
export interface PlayPauseCommand {
  op: 'playback.playPause';
  /** Omit to toggle; set explicitly to force a state. */
  play?: boolean;
}

/** Ask the receiver what it can see and do right now. Used by the dashboard. */
export interface StatusCommand {
  op: 'device.status';
}

export type Command =
  | FullscreenCommand
  | FullscreenExitCommand
  | SeekCommand
  | SeekToCommand
  | PlayPauseCommand
  | StatusCommand;

export type CommandOp = Command['op'];

// --------------------------------------------------------------------------
// Envelope
// --------------------------------------------------------------------------

export type MessageType = 'hello' | 'cmd' | 'ack' | 'event' | 'ping' | 'pong';

export interface BaseEnvelope {
  v: typeof PROTOCOL_VERSION;
  /** UUIDv4. Idempotency key — the receiver dedupes on this. */
  id: string;
  /** Epoch ms at the sender. Messages older than SKEW_TOLERANCE_MS are dropped. */
  ts: number;
  type: MessageType;
  /** Hex HMAC-SHA256 of the canonical body. Absent only on `hello`. */
  sig?: string;
}

export interface HelloEnvelope extends BaseEnvelope {
  type: 'hello';
  deviceId: string;
  deviceName: string;
  role: 'controller' | 'receiver';
  /** Which transport this hello arrived on, for the receiver's own bookkeeping. */
  transport: string;
}

export interface CommandEnvelope extends BaseEnvelope {
  type: 'cmd';
  cmd: Command;
  /**
   * When true the controller mirrors this command on a standby transport too.
   * Dedupe on `id` guarantees it still executes exactly once.
   */
  critical?: boolean;
}

/**
 * Which layer actually carried out the command. Invaluable when debugging.
 * `dom` and `cdp` belong to the browser extension receiver: a direct call on
 * the page's <video>, or the same through the DevTools protocol when the page
 * demands a real user gesture (fullscreen).
 */
export type ExecutorId =
  | 'mediasession'
  | 'accessibility'
  | 'shizuku'
  | 'settings'
  | 'dom'
  | 'cdp';

/** What kind of receiver answered. Lets one controller drive several targets. */
export type ReceiverKind = 'android' | 'browser';

export interface AckEnvelope extends BaseEnvelope {
  type: 'ack';
  /** The `id` of the command being acknowledged. */
  ref: string;
  ok: boolean;
  executedBy?: ExecutorId;
  /** Human-readable reason on failure, or a short note on success. */
  detail?: string;
  /** Round-trip diagnostics: ms spent inside the receiver. */
  tookMs?: number;
}

export interface DeviceStatus {
  foregroundPackage: string | null;
  /** True when a media session exists and reports a duration. */
  hasMediaSession: boolean;
  positionMs: number | null;
  durationMs: number | null;
  isPlaying: boolean;
  /** Executors currently available — drives which buttons the controller enables. */
  executors: ExecutorId[];
  /** Whether the foreground app has a fullscreen recipe. */
  recipeKnown: boolean;
  batteryPercent: number | null;
  /** Optional from here on: older receivers omit them. */
  kind?: ReceiverKind;
  /** Title of what is playing, when the receiver can see it. */
  title?: string | null;
  /** Whether the foreground player is fullscreen, when the receiver can tell. */
  fullscreen?: boolean | null;
}

export interface EventEnvelope extends BaseEnvelope {
  type: 'event';
  event: 'status' | 'transport' | 'error';
  status?: DeviceStatus;
  detail?: string;
}

export interface PingEnvelope extends BaseEnvelope {
  type: 'ping' | 'pong';
  /** Echoed back so the sender can compute RTT without keeping a table. */
  nonce: string;
}

export type Envelope =
  | HelloEnvelope
  | CommandEnvelope
  | AckEnvelope
  | EventEnvelope
  | PingEnvelope;

// --------------------------------------------------------------------------
// Constants both sides must agree on
// --------------------------------------------------------------------------

export const SKEW_TOLERANCE_MS = 30_000;
export const DEDUPE_WINDOW_SIZE = 256;
export const DEFAULT_LAN_PORT = 47821;
/** Service type advertised over NSD/mDNS for LAN discovery. */
export const MDNS_SERVICE_TYPE = '_relayctl._tcp';

/**
 * Transport ids, shared by both ends so a receiver can report which paths are
 * live and the controller can order them. The order here is only the default;
 * the user's own order, stored on the controller, is what ranks them.
 */
export const TRANSPORT_IDS = ['lan', 'webrtc', 'relay', 'http', 'mqtt', 'ble'] as const;
export type TransportId = (typeof TRANSPORT_IDS)[number];

/** WebRTC signalling rides the relay in a sibling room, never the command room. */
export const RTC_ROOM_SUFFIX = '-rtc';
/** MQTT topics are `${MQTT_TOPIC_PREFIX}/${room}/${role}` — each side subscribes to its own role. */
export const MQTT_TOPIC_PREFIX = 'relayctl';
/**
 * A public broker works because every frame is HMAC-signed: nobody on the broker
 * can forge or replay a command. It can still read them — seek amounts and
 * package names — so self-host (mosquitto with websockets) if that matters.
 */
export const DEFAULT_MQTT_URL = 'wss://broker.hivemq.com:8884/mqtt';
export const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
