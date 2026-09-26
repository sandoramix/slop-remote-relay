import {
  AckEnvelope,
  Command,
  CommandEnvelope,
  DedupeWindow,
  DEDUPE_WINDOW_SIZE,
  decodeAndVerify,
  DeviceStatus,
  Envelope,
  EventEnvelope,
  PROTOCOL_VERSION,
  sign,
  Signer,
  TopologySnapshot,
  Transport,
  TransportManager,
} from '@relay/protocol';
import { uuid } from './crypto';

export interface ClientEvents {
  onTopology: (snapshot: TopologySnapshot) => void;
  onStatus: (status: DeviceStatus) => void;
  onLog: (line: string) => void;
}

export interface ClientOptions {
  transports: Transport[];
  hmac: (message: string) => Promise<string>;
  /** Commands mirrored across two paths; the receiver dedupes on id. */
  mirrorCritical: boolean;
}

export interface CommandResult extends AckEnvelope {
  /** Wall-clock round trip seen by the controller, for the result toast. */
  rttMs: number;
  /** Which path the command left on. */
  via: string | null;
}

/**
 * Everything the UI talks to. Signs outgoing envelopes, verifies incoming ones,
 * and turns the ack round-trip into a promise so a button press can show
 * success or failure.
 */
export class RelayClient {
  private manager: TransportManager | null = null;
  private readonly signer: Signer;
  private readonly dedupe = new DedupeWindow(DEDUPE_WINDOW_SIZE);
  private readonly waiting = new Map<
    string,
    { resolve: (ack: AckEnvelope) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private topology: TopologySnapshot | null = null;

  constructor(
    private readonly options: ClientOptions,
    private readonly events: ClientEvents,
  ) {
    this.signer = { hmac: options.hmac };
  }

  async start(): Promise<void> {
    if (this.options.transports.length === 0) {
      throw new Error('Nessun percorso utilizzabile per questo dispositivo');
    }
    if (this.options.transports.length < 2) {
      this.events.onLog('Solo un percorso attivo: nessun fallback disponibile.');
    }
    this.manager = new TransportManager(this.options.transports, {
      onMessage: (raw) => void this.handleInbound(raw),
      onTopologyChange: (snapshot) => {
        this.topology = snapshot;
        this.events.onTopology(snapshot);
      },
      signPing: (ping) => sign(ping, this.signer),
    });
    await this.manager.start();
  }

  async stop(): Promise<void> {
    for (const { timer } of this.waiting.values()) clearTimeout(timer);
    this.waiting.clear();
    await this.manager?.stop();
    this.manager = null;
  }

  /** Sends a command and resolves with the receiver's ack, or rejects on timeout. */
  async send(cmd: Command, timeoutMs = 6000): Promise<CommandResult> {
    if (!this.manager) throw new Error('Non collegato');

    const envelope: CommandEnvelope = {
      v: PROTOCOL_VERSION,
      id: uuid(),
      ts: Date.now(),
      type: 'cmd',
      cmd,
      critical: this.options.mirrorCritical,
    };
    const signed = await sign(envelope, this.signer);
    const started = Date.now();
    const via = this.topology?.activeId ?? null;

    const ack = new Promise<AckEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(envelope.id);
        reject(new Error('Nessuna risposta dal ricevitore'));
      }, timeoutMs);
      this.waiting.set(envelope.id, { resolve, timer });
    });

    try {
      await this.manager.send(JSON.stringify(signed), this.options.mirrorCritical);
    } catch (error) {
      const pending = this.waiting.get(envelope.id);
      if (pending) clearTimeout(pending.timer);
      this.waiting.delete(envelope.id);
      throw error;
    }
    const result = await ack;
    return { ...result, rttMs: Date.now() - started, via };
  }

  seek = (deltaMs: number) => this.send({ op: 'playback.seek', deltaMs: Math.round(deltaMs) });
  seekTo = (positionMs: number) =>
    this.send({ op: 'playback.seekTo', positionMs: Math.max(0, Math.round(positionMs)) });
  fullscreen = (toggle = true) => this.send({ op: 'fullscreen.enter', toggle });
  exitFullscreen = () => this.send({ op: 'fullscreen.exit' });
  playPause = (play?: boolean) =>
    this.send(play === undefined ? { op: 'playback.playPause' } : { op: 'playback.playPause', play });

  /**
   * device.status is answered with a status event, not an ack, so this sends
   * and forgets: the event arrives through onStatus.
   */
  async refreshStatus(): Promise<void> {
    if (!this.manager) return;
    const envelope: CommandEnvelope = {
      v: PROTOCOL_VERSION,
      id: uuid(),
      ts: Date.now(),
      type: 'cmd',
      cmd: { op: 'device.status' },
    };
    const signed = await sign(envelope, this.signer);
    await this.manager.send(JSON.stringify(signed));
  }

  private async handleInbound(raw: string): Promise<void> {
    const result = await decodeAndVerify(raw, this.signer);
    if (!result.ok) {
      this.events.onLog(`Messaggio scartato: ${result.reason}`);
      return;
    }

    const env: Envelope = result.envelope;
    // The same reply can arrive twice when a command was mirrored.
    if (!this.dedupe.admit(env.id)) return;

    if (env.type === 'ack') {
      const pending = this.waiting.get(env.ref);
      if (pending) {
        clearTimeout(pending.timer);
        this.waiting.delete(env.ref);
        pending.resolve(env);
      }
      return;
    }

    if (env.type === 'event') {
      const e = env as EventEnvelope;
      if (e.event === 'status' && e.status) this.events.onStatus(e.status);
      else if (e.detail) this.events.onLog(e.detail);
    }
  }
}
