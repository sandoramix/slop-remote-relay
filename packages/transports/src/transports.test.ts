/**
 * Runs the shared transports against a real relay on a random port, in Node
 * (which has WebSocket and fetch built in). WebRTC runs over node-datachannel's
 * polyfill, which is libdatachannel — a real ICE/DTLS/SCTP stack, not a mock.
 *
 *   npm test -w @relay/transports
 *
 * MQTT against a live broker only runs when RELAY_TEST_MQTT is set to a broker
 * URL, because it needs the internet: RELAY_TEST_MQTT=wss://broker.hivemq.com:8884/mqtt
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Transport, TransportEvents } from '@relay/protocol';
import {
  MqttParser,
  MqttTransport,
  RelayHttpTransport,
  RelayWsTransport,
  WebRtcTransport,
  type PeerConnectionFactory,
} from './index';
import * as codec from './mqttCodec';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

let relay: ChildProcess;
let base = '';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  relay = spawn(process.execPath, ['--import', 'tsx', 'services/relay/src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    relay.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) resolve();
    });
    relay.once('exit', (code) => reject(new Error(`relay exited ${code}`)));
  });
  base = `ws://127.0.0.1:${port}`;
});

after(async () => {
  relay?.kill();
  // libdatachannel runs its own threads; without this the process never exits.
  const ndc = (await import("node-datachannel")) as unknown as { cleanup?: () => void; default?: { cleanup?: () => void } };
  (ndc.cleanup ?? ndc.default?.cleanup)?.();
});

interface Probe {
  events: TransportEvents;
  inbox: string[];
  states: string[];
}

function probe(): Probe {
  const inbox: string[] = [];
  const states: string[] = [];
  return {
    inbox,
    states,
    events: {
      onMessage: (raw) => inbox.push(raw),
      onStateChange: (s, d) => states.push(d ? `${s}:${d}` : s),
    },
  };
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function roundTrip(a: Transport, b: Transport): Promise<void> {
  const pa = probe();
  const pb = probe();
  await Promise.all([a.connect(pa.events), b.connect(pb.events)]);
  // connect() resolving is not the same as ready for both roles: a WebRTC
  // answerer is "listening" once signalling is up, and its data channel opens
  // a moment after the offerer's. Wait for both to say so.
  await until(() => pa.states.includes('connected') && pb.states.includes('connected'));
  try {
    await a.send('{"n":1,"s":"città 🎬"}');
    await until(() => pb.inbox.length > 0);
    assert.equal(pb.inbox[0], '{"n":1,"s":"città 🎬"}');
    await b.send('{"n":2}');
    await until(() => pa.inbox.length > 0);
    assert.equal(pa.inbox[0], '{"n":2}');
  } finally {
    await a.close();
    await b.close();
  }
}

const room = () => `test${Math.random().toString(36).slice(2, 12)}`;

describe('relay WebSocket', () => {
  it('carries frames both ways', async () => {
    const r = room();
    await roundTrip(
      new RelayWsTransport({ url: base, room: r, role: 'controller' }),
      new RelayWsTransport({ url: base, room: r, role: 'receiver' }),
    );
  });

  it('a reconnecting member replaces its stale slot', async () => {
    const r = room();
    const first = probe();
    const stale = new RelayWsTransport({ url: base, room: r, role: 'receiver' });
    await stale.connect(first.events);
    const fresh = new RelayWsTransport({ url: base, room: r, role: 'receiver' });
    const controller = new RelayWsTransport({ url: base, room: r, role: 'controller' });
    await roundTrip(controller, fresh);
    await until(() => first.states.some((s) => s.startsWith('failed')));
    await stale.close();
  });
});

describe('relay HTTP', () => {
  it('carries frames both ways over long-poll', async () => {
    const r = room();
    await roundTrip(
      new RelayHttpTransport({ url: base, room: r, role: 'controller' }),
      new RelayHttpTransport({ url: base, room: r, role: 'receiver' }),
    );
  });

  it('falls across to a peer that only has a WebSocket', async () => {
    const r = room();
    await roundTrip(
      new RelayHttpTransport({ url: base, room: r, role: 'controller' }),
      new RelayWsTransport({ url: base, room: r, role: 'receiver' }),
    );
  });

  it('prefers the same channel when the peer has both', async () => {
    const r = room();
    const ws = probe();
    const http = probe();
    const rxWs = new RelayWsTransport({ url: base, room: r, role: 'receiver' });
    const rxHttp = new RelayHttpTransport({ url: base, room: r, role: 'receiver' });
    const tx = new RelayWsTransport({ url: base, room: r, role: 'controller' });
    await Promise.all([rxWs.connect(ws.events), rxHttp.connect(http.events), tx.connect(probe().events)]);
    await tx.send('only-ws');
    await until(() => ws.inbox.length > 0);
    await new Promise((res) => setTimeout(res, 300));
    assert.deepEqual(http.inbox, []);
    await Promise.all([rxWs.close(), rxHttp.close(), tx.close()]);
  });
});

describe('MQTT codec', () => {
  it('parses what it encodes, split across chunks', () => {
    const payload = 'x'.repeat(300) + ' è 🎬';
    const bytes = codec.publish('relayctl/room/receiver', payload);
    const parser = new MqttParser();
    assert.deepEqual(parser.push(bytes.subarray(0, 3)), []);
    const [p] = parser.push(bytes.subarray(3));
    assert.ok(p && p.type === codec.PacketType.PUBLISH);
    assert.equal(p.topic, 'relayctl/room/receiver');
    assert.equal(p.payload, payload);
  });

  it('parses two packets in one chunk', () => {
    const joined = new Uint8Array([...codec.pingreq(), 0x20, 2, 0, 0]);
    const out = new MqttParser().push(joined);
    assert.equal(out.length, 2);
    assert.equal(out[1]!.type, codec.PacketType.CONNACK);
  });
});

describe('MQTT broker', { skip: !process.env.RELAY_TEST_MQTT }, () => {
  it('carries frames both ways', async () => {
    const r = room();
    const url = process.env.RELAY_TEST_MQTT!;
    await roundTrip(
      new MqttTransport({ url, room: r, role: 'controller' }),
      new MqttTransport({ url, room: r, role: 'receiver' }),
    );
  });
});

describe('WebRTC', { timeout: 20_000 }, () => {
  it('opens a data channel through relay signalling', async () => {
    const { RTCPeerConnection } = (await import('node-datachannel/polyfill')) as unknown as {
      RTCPeerConnection: new (c: unknown) => unknown;
    };
    const factory: PeerConnectionFactory = (config) =>
      new RTCPeerConnection(config) as ReturnType<PeerConnectionFactory>;
    const secret = 'test-secret';
    const hmac = async (m: string) => createHmac('sha256', secret).update(m).digest('hex');
    const r = room();

    const receiver = new WebRtcTransport({
      signalUrl: base,
      room: r,
      role: 'receiver',
      createPeerConnection: factory,
      hmac,
      stunUrls: [],
    });
    const controller = new WebRtcTransport({
      signalUrl: base,
      room: r,
      role: 'controller',
      createPeerConnection: factory,
      hmac,
      stunUrls: [],
    });
    // Receiver first, so the controller's offer finds it listening. The
    // reverse order is covered by the receiver's `ready`.
    await roundTrip(receiver, controller);
  });

  it('ignores signalling signed with the wrong key', async () => {
    const { RTCPeerConnection } = (await import('node-datachannel/polyfill')) as unknown as {
      RTCPeerConnection: new (c: unknown) => unknown;
    };
    const factory: PeerConnectionFactory = (config) =>
      new RTCPeerConnection(config) as ReturnType<PeerConnectionFactory>;
    const r = room();
    const make = (role: 'controller' | 'receiver', key: string) =>
      new WebRtcTransport({
        signalUrl: base,
        room: r,
        role,
        createPeerConnection: factory,
        hmac: async (m) => createHmac('sha256', key).update(m).digest('hex'),
        stunUrls: [],
        connectTimeoutMs: 2500,
      });
    const receiver = make('receiver', 'right');
    await receiver.connect(probe().events);
    await assert.rejects(make('controller', 'wrong').connect(probe().events), /ICE did not complete/);
    await receiver.close();
  });
});
