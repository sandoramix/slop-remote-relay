import {
  AckEnvelope,
  Command,
  CommandEnvelope,
  DeviceStatus,
  DedupeWindow,
  DEDUPE_WINDOW_SIZE,
  decodeAndVerify,
  Envelope,
  EventEnvelope,
  PROTOCOL_VERSION,
  sign,
  Signer,
  TopologySnapshot,
  Transport,
  TransportManager,
} from '@relay/protocol';
import { LanWebSocketTransport } from './LanWebSocketTransport';
import { RelayTransport } from './RelayTransport';
import { BleTransport } from './BleTransport';
import { hmacSha256Hex, uuid } from '../state/crypto';

export interface ClientConfig {
  pairSecret: string;
  lanHost: string | null;
  relayUrl: string | null;
  relayRoom: string | null;
  bleDeviceId: string | null;
  /** Commands the user considers too important to lose. Mirrored across two paths. */
  mirrorCritical: boolean;
}

export interface ClientEvents {
  onTopology: (snapshot: TopologySnapshot) => void;
  onStatus: (status: DeviceStatus) => void;
  onLog: (line: string) => void;
}

/**
 * Everything the UI talks to. Builds the transport chain from config, signs
 * outgoing envelopes, verifies incoming ones, and turns the ack round-trip into
 * a promise so a button press can show success or failure.
 */
export class RelayClient {
  private manager: TransportManager | null = null;
  private readonly signer: Signer;
  private readonly dedupe = new DedupeWindow(DEDUPE_WINDOW_SIZE);
  private readonly waiting = new Map<
    string,
    { resolve: (ack: AckEnvelope) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private config: ClientConfig,
    private readonly events: ClientEvents,
  ) {
    this.signer = { hmac: (msg) => hmacSha256Hex(this.config.pairSecret, msg) };
  }

  /**
   * Builds the candidate list. A transport with no configuration is simply left
   * out — the manager copes with one path, but the whole design assumes at least
   * two are configured.
   */
  private buildTransports(): Transport[] {
    const list: Transport[] = [];

    if (this.config.lanHost) {
      list.push(new LanWebSocketTransport({ host: this.config.lanHost }));
    }
    if (this.config.relayUrl && this.config.relayRoom) {
      list.push(
        new RelayTransport({
          url: this.config.relayUrl,
          room: this.config.relayRoom,
        }),
      );
    }
    if (this.config.bleDeviceId) {
      list.push(new BleTransport(this.config.bleDeviceId));
    }

    if (list.length === 0) throw new Error('No transport configured');
    if (list.length < 2) {
      this.events.onLog(
        'Solo un percorso configurato: nessun fallback disponibile.',
      );
    }
    return list;
  }

  async start(): Promise<void> {
    await this.stop();
    this.manager = new TransportManager(this.buildTransports(), {
      onMessage: (raw) => void this.handleInbound(raw),
      onTopologyChange: (snapshot) => this.events.onTopology(snapshot),
    });
    await this.manager.start();
  }

  async stop(): Promise<void> {
    await this.manager?.stop();
    this.manager = null;
  }

  async updateConfig(next: Partial<ClientConfig>): Promise<void> {
    this.config = { ...this.config, ...next };
    if (this.manager) await this.start();
  }

  // ------------------------------------------------------------------ sending

  /** Sends a command and resolves with the receiver's ack, or rejects on timeout. */
  async send(cmd: Command, timeoutMs = 5000): Promise<AckEnvelope> {
    if (!this.manager) throw new Error('Client not started');

    const envelope: CommandEnvelope = {
      v: PROTOCOL_VERSION,
      id: uuid(),
      ts: Date.now(),
      type: 'cmd',
      cmd,
      critical: this.config.mirrorCritical,
    };
    const signed = await sign(envelope, this.signer);

    const ack = new Promise<AckEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(envelope.id);
        reject(new Error('Nessuna risposta dal ricevitore'));
      }, timeoutMs);
      this.waiting.set(envelope.id, { resolve, timer });
    });

    await this.manager.send(JSON.stringify(signed), this.config.mirrorCritical);
    return ack;
  }

  seek(deltaMs: number) {
    return this.send({ op: 'playback.seek', deltaMs });
  }

  fullscreen(toggle = true) {
    return this.send({ op: 'fullscreen.enter', toggle });
  }

  playPause() {
    return this.send({ op: 'playback.playPause' });
  }

  refreshStatus() {
    return this.send({ op: 'device.status' });
  }

  // ---------------------------------------------------------------- receiving

  private async handleInbound(raw: string): Promise<void> {
    const result = await decodeAndVerify(raw, this.signer);
    if (!result.ok) {
      this.events.onLog(`Messaggio scartato: ${result.reason}`);
      return;
    }

    const env: Envelope = result.envelope;
    // The same ack can arrive twice when a critical command was mirrored.
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
