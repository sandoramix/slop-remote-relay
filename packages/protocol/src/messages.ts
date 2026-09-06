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

/** Move playback by a relative amount. Negative rewinds. */
export interface SeekCommand {
  op: 'playback.seek';
  deltaMs: number;
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
  | SeekCommand
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

/** Which layer actually carried out the command. Invaluable when debugging. */
export type ExecutorId = 'mediasession' | 'accessibility' | 'shizuku' | 'settings';

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
