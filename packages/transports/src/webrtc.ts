import type { Transport, TransportEvents } from '@relay/protocol';
import { DEFAULT_STUN_URLS, RTC_ROOM_SUFFIX } from '@relay/protocol';
import { openSocket, randomId, RoomOptions, trimBase } from './common';

/**
 * The minimal RTCPeerConnection surface this file touches. Declared here so the
 * same class runs on react-native-webrtc and on the browser's own WebRTC, whose
 * types are close but not identical.
 */
export interface PeerConnectionLike {
  createDataChannel(label: string, init?: { ordered?: boolean }): DataChannelLike;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(desc: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: string; sdp?: string }): Promise<void>;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  close(): void;
  connectionState?: string;
  onicecandidate: ((e: { candidate: { toJSON(): IceCandidateInit } | null }) => void) | null;
  ondatachannel: ((e: { channel: DataChannelLike }) => void) | null;
  onconnectionstatechange: (() => void) | null;
}

export interface DataChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

export type PeerConnectionFactory = (config: {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}) => PeerConnectionLike;

export interface WebRtcOptions extends RoomOptions {
  /** The relay, used only for signalling, in the sibling room `<room>-rtc`. */
  signalUrl: string;
  createPeerConnection: PeerConnectionFactory;
  /** HMAC with the pair secret. Signalling is signed so the relay cannot inject SDP. */
  hmac: (message: string) => Promise<string>;
  stunUrls?: string[];
  /** Optional TURN, for carrier NATs where a direct path never forms. */
  turn?: { urls: string; username: string; credential: string } | null;
  connectTimeoutMs?: number;
  /** Negotiation trace, for the diagnostics screen and for tests. */
  debug?: (line: string) => void;
}

type SignalKind = 'ready' | 'offer' | 'answer' | 'ice';

interface Signal {
  k: SignalKind;
  /** Negotiation id, so late candidates from an abandoned attempt are ignored. */
  sid: string;
  ts: number;
  /** Payload as a JSON string: both languages then sign the same bytes. */
  d: string;
  sig: string;
}

/**
 * Peer-to-peer DataChannel, with the relay as signalling server only.
 *
 * When ICE finds a direct route this is the lowest-latency remote path there
 * is, and it keeps working if the relay goes down after the channel opens. On
 * symmetric carrier NAT it often never forms without TURN; that is expected, and
 * is why the relay WebSocket stays underneath it in the failover order.
 *
 * The controller offers, the receiver answers. The receiver keeps its signalling
 * socket open and says `ready` on arrival, which makes the controller (re)offer,
 * so either side can restart in any order.
 */
export class WebRtcTransport implements Transport {
  readonly id = 'webrtc';
  readonly label = 'WebRTC P2P';
  readonly priority: number;
  readonly worksRemotely = true;

  private signal: WebSocket | null = null;
  private pc: PeerConnectionLike | null = null;
  private channel: DataChannelLike | null = null;
  private sid = '';
  private pendingIce: IceCandidateInit[] = [];
  private remoteSet = false;
  private events: TransportEvents | null = null;
  private closed = false;

  constructor(private readonly options: WebRtcOptions) {
    this.priority = options.priority ?? 5;
  }

  /** True once the DataChannel is open. What a receiver-side set reports. */
  isUp(): boolean {
    return this.channel?.readyState === 'open';
  }

  async connect(events: TransportEvents): Promise<void> {
    this.events = events;
    this.closed = false;
    const { signalUrl, room, role, connectTimeoutMs = 15_000 } = this.options;
    const url = `${trimBase(signalUrl)}/room/${encodeURIComponent(room + RTC_ROOM_SUFFIX)}?role=${role}&ch=ws`;
    const socket = await openSocket(url, 6000);
    this.signal = socket;
    socket.onmessage = (e) => void this.onSignal(String(e.data));

    if (role === 'receiver') {
      socket.onclose = () => {
        if (this.signal === socket && !this.closed) {
          events.onStateChange('failed', 'signalling closed');
        }
      };
      await this.sendSignal('ready', {});
      return;
    }

    // Controller: offer now, and again whenever the receiver announces itself.
    // The waiter is armed before the first offer, and the offer is not awaited:
    // a receiver joining mid-negotiation supersedes it with a fresh one, and the
    // abandoned attempt may never settle on its closed peer connection.
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('ICE did not complete'));
        this.teardown();
      }, connectTimeoutMs);
      this.onOpen = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    void this.offer();
    await opened;

    // The channel is up; signalling has done its job. Dropping it frees the
    // relay slot and means a relay outage no longer touches this path.
    socket.onclose = null;
    this.signal = null;
    socket.close();
    events.onStateChange('connected');
  }

  private onOpen: (() => void) | null = null;

  private iceServers() {
    const { stunUrls = DEFAULT_STUN_URLS, turn } = this.options;
    const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
    // An entry with an empty urls list is a SyntaxError in spec-strict stacks,
    // so a LAN-only setup with no STUN must pass no entry at all.
    if (stunUrls.length) servers.push({ urls: stunUrls });
    if (turn) servers.push(turn);
    return servers;
  }

  private newPeer(): PeerConnectionLike {
    // Forget the old channel before closing, so its close event is not taken
    // for the loss of the current one.
    this.channel = null;
    this.pc?.close();
    this.pendingIce = [];
    this.remoteSet = false;

    const pc = this.options.createPeerConnection({ iceServers: this.iceServers() });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.sendSignal('ice', e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.lost('peer connection ' + pc.connectionState);
      }
    };
    return pc;
  }

  private bindChannel(channel: DataChannelLike): void {
    this.channel = channel;
    channel.onopen = () => {
      this.options.debug?.(`channel open sid=${this.sid}`);
      this.onOpen?.();
      this.onOpen = null;
      if (this.options.role === 'receiver') this.events?.onStateChange('connected');
    };
    channel.onmessage = (e) => this.events?.onMessage(String(e.data));
    channel.onclose = () => {
      if (this.channel === channel) this.lost('data channel closed');
    };
  }

  private lost(reason: string): void {
    if (this.closed) return;
    this.channel = null;
    // A receiver stays reachable for the next offer; a controller reports the
    // failure so the manager fails over and redials with backoff.
    if (this.options.role === 'controller') this.events?.onStateChange('failed', reason);
  }

  private async offer(): Promise<void> {
    this.sid = randomId();
    const pc = this.newPeer();
    this.bindChannel(pc.createDataChannel('relay', { ordered: true }));
    try {
      const offer = await pc.createOffer();
      if (this.pc !== pc) return; // superseded by a newer offer
      await pc.setLocalDescription(offer);
      if (this.pc !== pc) return;
      await this.sendSignal('offer', { type: offer.type, sdp: offer.sdp });
    } catch (error) {
      if (this.pc === pc) this.options.debug?.(`offer failed: ${(error as Error).message}`);
    }
  }

  private async onSignal(raw: string): Promise<void> {
    let s: Signal;
    try {
      s = JSON.parse(raw) as Signal;
    } catch {
      return;
    }
    if (!s || typeof s.d !== 'string' || typeof s.sig !== 'string') return;
    const expected = await this.options.hmac(signable(s.k, s.sid, s.ts, s.d));
    if (expected !== s.sig) return;
    if (Math.abs(Date.now() - s.ts) > 60_000) return;
    const data = JSON.parse(s.d) as Record<string, unknown>;
    this.options.debug?.(`<- ${s.k} sid=${s.sid} (mine=${this.sid})`);

    const { role } = this.options;
    try {
      if (role === 'controller') {
        if (s.k === 'ready' && !this.isUp()) await this.offer();
        else if (s.k === 'answer' && s.sid === this.sid && this.pc) {
          await this.pc.setRemoteDescription(data as { type: string; sdp: string });
          await this.flushIce();
        } else if (s.k === 'ice' && s.sid === this.sid) await this.addIce(data);
      } else {
        if (s.k === 'offer') {
          this.sid = s.sid;
          const pc = this.newPeer();
          pc.ondatachannel = (e) => this.bindChannel(e.channel);
          await pc.setRemoteDescription(data as { type: string; sdp: string });
          await this.flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.sendSignal('answer', { type: answer.type, sdp: answer.sdp });
        } else if (s.k === 'ice' && s.sid === this.sid) await this.addIce(data);
      }
    } catch (error) {
      console.warn('[webrtc] negotiation step failed', error);
    }
  }

  private async addIce(candidate: IceCandidateInit): Promise<void> {
    if (!this.pc) return;
    if (!this.remoteSet) {
      this.pendingIce.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  private async flushIce(): Promise<void> {
    this.remoteSet = true;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }

  private async sendSignal(k: SignalKind, data: object): Promise<void> {
    const socket = this.signal;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const d = JSON.stringify(data);
    this.options.debug?.(`-> ${k} sid=${this.sid}`);
    const ts = Date.now();
    const sig = await this.options.hmac(signable(k, this.sid, ts, d));
    socket.send(JSON.stringify({ k, sid: this.sid, ts, d, sig } satisfies Signal));
  }

  async send(raw: string): Promise<void> {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this.channel.send(raw);
  }

  private teardown(): void {
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    const socket = this.signal;
    this.signal = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onOpen = null;
    this.teardown();
  }
}

/** What the signalling HMAC covers. Kotlin's WebRtcTransport builds the same string. */
export const signable = (k: string, sid: string, ts: number, d: string): string =>
  `rtc|${k}|${sid}|${ts}|${d}`;
