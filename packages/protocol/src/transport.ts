import { Envelope, PingEnvelope, PROTOCOL_VERSION } from './messages';

/**
 * Transport abstraction.
 *
 * Everything above this line is transport-agnostic. Adding a fourth path (say,
 * WebRTC once the relay is in place) means writing one class here and adding it
 * to the manager's candidate list — no changes to commands, UI, or the receiver's
 * action layer.
 */

export type TransportState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'failed';

export interface TransportEvents {
  onMessage: (raw: string) => void;
  onStateChange: (state: TransportState, detail?: string) => void;
}

export interface Transport {
  readonly id: string;
  /** Human label for the connection strip in the UI. */
  readonly label: string;
  /**
   * Lower is better. The manager always prefers the lowest available number.
   * The controller derives it from the user's order: rank × 10.
   */
  readonly priority: number;
  /** False for transports that only work on the same network. */
  readonly worksRemotely: boolean;

  connect(events: TransportEvents): Promise<void>;
  send(raw: string): Promise<void>;
  close(): Promise<void>;
}

// --------------------------------------------------------------------------

export interface ManagerConfig {
  /** How often to ping the active transport. */
  heartbeatMs: number;
  /** How often to ping warm standbys, so failover is instant rather than cold. */
  standbyProbeMs: number;
  /** Consecutive missed heartbeats before the active transport is demoted. */
  missTolerance: number;
  /**
   * A better transport must stay healthy this long before we switch back to it.
   * Without this the app flaps between Wi-Fi and relay at the edge of coverage.
   */
  promoteStableMs: number;
  /**
   * Right after start every path is still dialling, and whichever answers
   * first would otherwise hold the lead for promoteStableMs. Inside this window
   * the best-ranked healthy path wins at once — there is nothing to flap yet —
   * so the user's chosen default is the one in use from the first second.
   */
  initialSettleMs: number;
  /** Ceiling for the exponential reconnect backoff. */
  maxBackoffMs: number;
  timeoutMs: number;
}

export const DEFAULT_MANAGER_CONFIG: ManagerConfig = {
  heartbeatMs: 4_000,
  standbyProbeMs: 20_000,
  missTolerance: 2,
  promoteStableMs: 15_000,
  initialSettleMs: 4_000,
  maxBackoffMs: 30_000,
  timeoutMs: 3_000,
};

interface Health {
  state: TransportState;
  rttMs: number | null;
  misses: number;
  healthySince: number | null;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

export interface ManagerEvents {
  onMessage: (raw: string) => void;
  /** Fires whenever the active transport or any health value changes. */
  onTopologyChange: (snapshot: TopologySnapshot) => void;
}

export interface TopologySnapshot {
  activeId: string | null;
  transports: Array<{
    id: string;
    label: string;
    state: TransportState;
    rttMs: number | null;
    active: boolean;
  }>;
}

/**
 * Keeps every configured transport warm in parallel and routes traffic over the
 * best one that is currently healthy.
 *
 * The important behaviours:
 *  - All transports connect concurrently at startup. We do not wait for LAN to
 *    fail before dialling the relay; standbys are already open when we need them.
 *  - Failover on the active path is immediate because the standby is already up.
 *  - Promotion back to a better path is deliberately slow (promoteStableMs).
 *  - `critical` sends are mirrored on the best standby. The receiver's dedupe
 *    window collapses the duplicate, so a command never lands twice.
 */
export class TransportManager {
  private readonly health = new Map<string, Health>();
  private readonly pending = new Map<string, (rtt: number) => void>();
  private activeId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private standbyTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private startedAt = 0;

  constructor(
    private readonly transports: Transport[],
    private readonly events: ManagerEvents,
    private readonly config: ManagerConfig = DEFAULT_MANAGER_CONFIG,
  ) {
    for (const t of transports) {
      this.health.set(t.id, {
        state: 'idle',
        rttMs: null,
        misses: 0,
        healthySince: null,
        attempt: 0,
        retryTimer: null,
      });
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.startedAt = Date.now();
    await Promise.allSettled(this.transports.map((t) => this.dial(t)));
    this.heartbeatTimer = setInterval(() => this.beatActive(), this.config.heartbeatMs);
    this.standbyTimer = setInterval(() => this.probeStandbys(), this.config.standbyProbeMs);
    this.reselect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.standbyTimer) clearInterval(this.standbyTimer);
    for (const h of this.health.values()) if (h.retryTimer) clearTimeout(h.retryTimer);
    await Promise.allSettled(this.transports.map((t) => t.close()));
    this.activeId = null;
    this.emit();
  }

  /**
   * Sends over the active transport. When `mirror` is set, also fires over the
   * best healthy standby — belt and braces for commands you do not want to lose
   * mid-failover.
   */
  async send(raw: string, mirror = false): Promise<void> {
    const active = this.activeTransport();
    if (!active) throw new Error('No transport available');

    const targets: Transport[] = [active];
    if (mirror) {
      const standby = this.rankedHealthy().find((t) => t.id !== active.id);
      if (standby) targets.push(standby);
    }

    const results = await Promise.allSettled(targets.map((t) => t.send(raw)));
    if (results.every((r) => r.status === 'rejected')) {
      this.markUnhealthy(active.id, 'send failed');
      throw new Error(`Send failed on ${targets.map((t) => t.id).join(', ')}`);
    }
  }

  snapshot(): TopologySnapshot {
    return {
      activeId: this.activeId,
      transports: this.transports.map((t) => {
        const h = this.health.get(t.id)!;
        return {
          id: t.id,
          label: t.label,
          state: h.state,
          rttMs: h.rttMs,
          active: t.id === this.activeId,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- internals

  private activeTransport(): Transport | null {
    return this.transports.find((t) => t.id === this.activeId) ?? null;
  }

  private rankedHealthy(): Transport[] {
    return [...this.transports]
      .filter((t) => this.health.get(t.id)!.state === 'connected')
      .sort((a, b) => a.priority - b.priority);
  }

  private async dial(t: Transport): Promise<void> {
    if (this.stopped) return;
    const h = this.health.get(t.id)!;
    h.state = 'connecting';
    this.emit();

    try {
      await t.connect({
        onMessage: (raw) => this.handleMessage(t.id, raw),
        onStateChange: (state, detail) => this.onTransportState(t.id, state, detail),
      });
      h.state = 'connected';
      h.misses = 0;
      h.attempt = 0;
      h.healthySince = Date.now();
      this.reselect();
    } catch (err) {
      this.scheduleRetry(t, err instanceof Error ? err.message : String(err));
    }
    this.emit();
  }

  private scheduleRetry(t: Transport, reason: string): void {
    const h = this.health.get(t.id)!;
    h.state = 'failed';
    h.healthySince = null;
    h.rttMs = null;
    if (this.stopped) return;

    // Exponential backoff with jitter — without the jitter, every transport that
    // dropped on the same network event retries in lockstep forever.
    const base = Math.min(1000 * 2 ** h.attempt, this.config.maxBackoffMs);
    const delay = base * (0.5 + Math.random() * 0.5);
    h.attempt += 1;

    if (h.retryTimer) clearTimeout(h.retryTimer);
    h.retryTimer = setTimeout(() => void this.dial(t), delay);
    console.warn(`[transport:${t.id}] ${reason} — retry in ${Math.round(delay)}ms`);
    this.reselect();
  }

  private onTransportState(id: string, state: TransportState, detail?: string): void {
    const t = this.transports.find((x) => x.id === id);
    if (!t) return;
    if (state === 'failed' || state === 'degraded') {
      this.scheduleRetry(t, detail ?? state);
    }
    this.emit();
  }

  private markUnhealthy(id: string, reason: string): void {
    const t = this.transports.find((x) => x.id === id);
    if (t) this.scheduleRetry(t, reason);
  }

  /**
   * Picks the active transport. Downgrades happen immediately; upgrades wait for
   * promoteStableMs of continuous health to avoid flapping.
   */
  private reselect(): void {
    const ranked = this.rankedHealthy();
    const best = ranked[0] ?? null;
    const current = this.activeTransport();
    const currentHealthy = current && this.health.get(current.id)!.state === 'connected';

    if (!currentHealthy) {
      if (best?.id !== this.activeId) {
        this.activeId = best?.id ?? null;
        console.info(`[transport] active → ${this.activeId ?? 'none'}`);
      }
      this.emit();
      return;
    }

    if (best && current && best.priority < current.priority) {
      const since = this.health.get(best.id)!.healthySince;
      const settling = Date.now() - this.startedAt < this.config.initialSettleMs;
      if (settling || (since !== null && Date.now() - since >= this.config.promoteStableMs)) {
        this.activeId = best.id;
        console.info(`[transport] promoted → ${best.id}`);
      }
    }
    this.emit();
  }

  private handleMessage(id: string, raw: string): void {
    // Intercept pongs here so RTT accounting never reaches application code.
    try {
      const parsed = JSON.parse(raw) as Envelope;
      if (parsed.type === 'pong') {
        const resolve = this.pending.get((parsed as PingEnvelope).nonce);
        if (resolve) resolve(Date.now() - parsed.ts);
        return;
      }
    } catch {
      /* fall through to the app; the codec will reject it properly */
    }
    const h = this.health.get(id);
    if (h) h.misses = 0;
    this.events.onMessage(raw);
  }

  private beatActive(): void {
    // Re-evaluated on every beat, not only on connect and failure: a better
    // path that came back has to be promoted once it has been healthy long
    // enough, and nothing else happens at that moment to trigger the check.
    this.reselect();
    const active = this.activeTransport();
    if (active) void this.pingOne(active, this.config.missTolerance);
  }

  private probeStandbys(): void {
    for (const t of this.transports) {
      if (t.id === this.activeId) continue;
      if (this.health.get(t.id)!.state !== 'connected') continue;
      void this.pingOne(t, this.config.missTolerance);
    }
  }

  private async pingOne(t: Transport, tolerance: number): Promise<void> {
    const h = this.health.get(t.id)!;
    const nonce = Math.random().toString(36).slice(2);
    const ping: PingEnvelope = {
      v: PROTOCOL_VERSION,
      id: nonce,
      ts: Date.now(),
      type: 'ping',
      nonce,
    };

    const rtt = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        resolve(null);
      }, this.config.timeoutMs);
      this.pending.set(nonce, (value) => {
        clearTimeout(timer);
        this.pending.delete(nonce);
        resolve(value);
      });
      t.send(JSON.stringify(ping)).catch(() => {
        clearTimeout(timer);
        this.pending.delete(nonce);
        resolve(null);
      });
    });

    if (rtt === null) {
      h.misses += 1;
      h.rttMs = null;
      if (h.misses >= tolerance) {
        h.state = 'degraded';
        this.markUnhealthy(t.id, `${h.misses} missed heartbeats`);
      }
    } else {
      h.misses = 0;
      h.rttMs = rtt;
      if (h.state !== 'connected') {
        h.state = 'connected';
        h.healthySince = Date.now();
      }
    }
    this.emit();
  }

  private emit(): void {
    this.events.onTopologyChange(this.snapshot());
  }
}
