/**
 * Every remote path against a live receiver, using the controller's own
 * transport classes from @relay/transports.
 *
 *   npm run relay
 *   tools/bench.sh                                  # receiver on the emulator
 *   npm run smoke:paths -- <pair-code> --relay ws://127.0.0.1:8080 [--mqtt wss://…] [--only webrtc,http]
 *
 * For each path: connect as the controller, send a signed ping and expect a
 * signed pong, then ask for device.status and expect a signed status event.
 * WebRTC runs over node-datachannel (libdatachannel), a real ICE stack.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Transport } from '../packages/protocol/src/transport';
import { canonicalize } from '../packages/protocol/src/codec';
import { DEFAULT_MQTT_URL, PROTOCOL_VERSION } from '../packages/protocol/src/messages';
import {
  MqttTransport,
  RelayHttpTransport,
  RelayWsTransport,
  WebRtcTransport,
  type PeerConnectionFactory,
} from '../packages/transports/src/index';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pairCode = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const relay = flag('--relay');
const mqttUrl = flag('--mqtt') ?? DEFAULT_MQTT_URL;
const only = flag('--only')?.split(',');

if (!pairCode || !relay) {
  console.error('usage: npm run smoke:paths -- <pair-code> --relay <ws-url> [--mqtt <wss-url>] [--only a,b]');
  process.exit(2);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = sha(`secret:${pairCode}`);
const room = sha(`room:${pairCode}`).slice(0, 24);
const hmac = async (m: string) => createHmac('sha256', secret).update(m).digest('hex');

function sign(body: Record<string, unknown>): string {
  const env: Record<string, unknown> = { v: PROTOCOL_VERSION, id: randomUUID(), ts: Date.now(), ...body };
  env.sig = createHmac('sha256', secret).update(canonicalize(env as never)).digest('hex');
  return JSON.stringify(env);
}
const verified = (e: Record<string, unknown>) =>
  e.sig === createHmac('sha256', secret).update(canonicalize(e as never)).digest('hex');

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function exercise(label: string, make: () => Promise<Transport>): Promise<void> {
  console.log(`\n[${label}]`);
  const inbox: Array<Record<string, unknown>> = [];
  let transport: Transport;
  try {
    transport = await make();
    const started = Date.now();
    await transport.connect({
      onMessage: (raw) => inbox.push(JSON.parse(raw) as Record<string, unknown>),
      onStateChange: () => undefined,
    });
    check('connects', true, `${Date.now() - started} ms`);
  } catch (error) {
    check('connects', false, (error as Error).message);
    return;
  }

  const wait = async (pred: (e: Record<string, unknown>) => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };

  const nonce = randomUUID();
  const t0 = Date.now();
  await transport.send(sign({ type: 'ping', nonce }));
  const pong = await wait((e) => e.type === 'pong' && e.nonce === nonce);
  check('signed ping → signed pong', !!pong && verified(pong), pong ? `${Date.now() - t0} ms` : 'no reply');

  await transport.send(sign({ type: 'cmd', cmd: { op: 'device.status' } }));
  const status = await wait((e) => e.type === 'event' && e.event === 'status');
  check('device.status', !!status && verified(status),
    status ? `executors ${JSON.stringify((status.status as { executors?: unknown }).executors)}` : 'no reply');

  await transport.close();
}

async function main(): Promise<void> {
  const paths: Array<[string, () => Promise<Transport>]> = [
    ['relay', async () => new RelayWsTransport({ url: relay!, room, role: 'controller' })],
    ['http', async () => new RelayHttpTransport({ url: relay!, room, role: 'controller' })],
    ['mqtt', async () => new MqttTransport({ url: mqttUrl, room, role: 'controller' })],
    [
      'webrtc',
      async () => {
        const { RTCPeerConnection } = (await import('node-datachannel/polyfill')) as unknown as {
          RTCPeerConnection: new (c: unknown) => ReturnType<PeerConnectionFactory>;
        };
        return new WebRtcTransport({
          signalUrl: relay!,
          room,
          role: 'controller',
          createPeerConnection: (c) => new RTCPeerConnection(c),
          hmac,
          connectTimeoutMs: 20_000,
        });
      },
    ],
  ];
  for (const [label, make] of paths) {
    if (only && !only.includes(label)) continue;
    await exercise(label, make);
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
