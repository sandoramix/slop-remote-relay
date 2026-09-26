import {
  type AckEnvelope,
  type CommandEnvelope,
  decodeAndVerify,
  DedupeWindow,
  DEDUPE_WINDOW_SIZE,
  type DeviceStatus,
  type Envelope,
  type EventEnvelope,
  type PingEnvelope,
  PROTOCOL_VERSION,
  sign,
  type Signer,
  type Transport,
} from '@relay/protocol';
import {
  MqttTransport,
  RelayHttpTransport,
  RelayWsTransport,
  WebRtcTransport,
  type PeerConnectionFactory,
} from '@relay/transports';
import type { ActionResult, BrowserTransportId, ExtensionSettings, PathState, RuntimeMessage } from './shared';

/**
 * The receiver runtime. Lives in an offscreen document because it needs
 * RTCPeerConnection, which a Manifest V3 service worker does not have.
 *
 * Same contract as the Android CommandRouter: verify the signature, drop
 * replays by id, execute, reply signed on the path the command came in on. The
 * controller mirrors critical commands across two paths; the dedupe window is
 * what keeps a "+30s" from jumping 60.
 */

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

let key: CryptoKey | null = null;
const signer: Signer = {
  hmac: async (m) => hex(await crypto.subtle.sign('HMAC', key!, enc.encode(m))),
};

interface Live {
  transport: Transport;
  up: boolean;
  stopped: boolean;
}

let live = new Map<BrowserTransportId, Live>();
const dedupe = new DedupeWindow(DEDUPE_WINDOW_SIZE);

async function envelope<T extends Envelope>(body: Omit<T, 'v' | 'id' | 'ts'> & { ts?: number }): Promise<string> {
  const env = { v: PROTOCOL_VERSION, id: crypto.randomUUID(), ts: Date.now(), ...body } as T;
  return JSON.stringify(await sign(env, signer));
}

async function handle(raw: string, from: BrowserTransportId): Promise<void> {
  const result = await decodeAndVerify(raw, signer);
  if (!result.ok) {
    console.warn(`[relay] frame rejected on ${from}: ${result.reason}`);
    return;
  }
  const env = result.envelope;
  const reply = (frame: string) => live.get(from)?.transport.send(frame).catch(() => undefined);

  if (env.type === 'ping') {
    // Echo the ping's timestamp so the controller measures a true round trip.
    await reply(await envelope<PingEnvelope>({ type: 'pong', nonce: (env as PingEnvelope).nonce, ts: env.ts }));
    return;
  }
  if (env.type !== 'cmd') return;
  if (!dedupe.admit(env.id)) return;

  const cmd = (env as CommandEnvelope).cmd;
  if (cmd.op === 'device.status') {
    const status = (await chrome.runtime.sendMessage({ to: 'worker', type: 'status' } satisfies RuntimeMessage)) as DeviceStatus;
    await reply(await envelope<EventEnvelope>({ type: 'event', event: 'status', status }));
    return;
  }

  const started = Date.now();
  let res: ActionResult & { executedBy?: 'dom' | 'cdp' };
  try {
    res = await chrome.runtime.sendMessage({ to: 'worker', type: 'execute', cmd } satisfies RuntimeMessage);
  } catch (error) {
    res = { ok: false, detail: (error as Error).message };
  }
  await reply(
    await envelope<AckEnvelope>({
      type: 'ack',
      ref: env.id,
      ok: res.ok,
      ...(res.executedBy ? { executedBy: res.executedBy } : {}),
      ...(res.detail ? { detail: res.detail } : {}),
      tookMs: Date.now() - started,
    }),
  );
}

function publishPaths(): void {
  const paths: PathState[] = [...live.entries()].map(([id, l]) => ({ id, up: l.up }));
  void chrome.runtime.sendMessage({ to: 'any', type: 'paths', paths } satisfies RuntimeMessage).catch(() => undefined);
}

/** Keeps one path up for as long as it is configured, redialling with backoff. */
async function run(id: BrowserTransportId, entry: Live): Promise<void> {
  let attempt = 0;
  while (!entry.stopped) {
    try {
      await new Promise<void>((resolve, reject) => {
        entry.transport
          .connect({
            onMessage: (raw) => void handle(raw, id),
            onStateChange: (state, detail) => {
              if (state === 'connected') {
                entry.up = true;
                attempt = 0;
                publishPaths();
              } else if (state === 'failed' || state === 'degraded') {
                entry.up = false;
                publishPaths();
                reject(new Error(detail ?? state));
              }
            },
          })
          .catch(reject);
      });
    } catch (error) {
      entry.up = false;
      publishPaths();
      if (entry.stopped) return;
      await entry.transport.close().catch(() => undefined);
      const wait = Math.min(1000 * 2 ** attempt++, 30_000) * (0.5 + Math.random() / 2);
      console.warn(`[relay] ${id} down (${(error as Error).message}), retry in ${Math.round(wait)} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function configure(settings: ExtensionSettings): Promise<void> {
  for (const l of live.values()) {
    l.stopped = true;
    void l.transport.close();
  }
  live = new Map();
  if (!settings.pairCode) return publishPaths();

  const secret = await sha256Hex(`secret:${settings.pairCode}`);
  const room = (await sha256Hex(`room:${settings.pairCode}`)).slice(0, 24);
  key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const factory: PeerConnectionFactory = (config) =>
    new RTCPeerConnection(config) as unknown as ReturnType<PeerConnectionFactory>;
  const candidates: Array<[BrowserTransportId, () => Transport | null]> = [
    ['webrtc', () => settings.relayUrl ? new WebRtcTransport({ signalUrl: settings.relayUrl, room, role: 'receiver', createPeerConnection: factory, hmac: signer.hmac }) : null],
    ['relay', () => settings.relayUrl ? new RelayWsTransport({ url: settings.relayUrl, room, role: 'receiver' }) : null],
    ['http', () => settings.relayUrl ? new RelayHttpTransport({ url: settings.relayUrl, room, role: 'receiver' }) : null],
    ['mqtt', () => settings.mqttUrl ? new MqttTransport({ url: settings.mqttUrl, room, role: 'receiver' }) : null],
  ];
  for (const [id, make] of candidates) {
    if (settings.disabled.includes(id)) continue;
    const transport = make();
    if (!transport) continue;
    const entry: Live = { transport, up: false, stopped: false };
    live.set(id, entry);
    void run(id, entry);
  }
  publishPaths();
}

/** Status pushed on every live path, like the Android receiver's status loop. */
async function broadcast(status: DeviceStatus): Promise<void> {
  if (!key) return;
  const frame = await envelope<EventEnvelope>({ type: 'event', event: 'status', status });
  for (const l of live.values()) if (l.up) void l.transport.send(frame).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, respond) => {
  if (msg.to !== 'offscreen') return false;
  if (msg.type === 'configure') void configure(msg.settings).then(() => respond(true));
  else if (msg.type === 'getPaths') respond([...live.entries()].map(([id, l]) => ({ id, up: l.up })));
  else if (msg.type === 'broadcastStatus') void broadcast(msg.status).then(() => respond(true));
  return true;
});
