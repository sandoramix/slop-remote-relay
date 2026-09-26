/**
 * Protocol smoke test against a running receiver.
 *
 * The original phase-2 check was written around two handsets, but most of what it
 * verifies is not about handsets at all: that the Kotlin side accepts a
 * signature the TypeScript side produced, that the reply verifies coming back,
 * that the dedupe window swallows a repeated id, and that forged and stale
 * frames are refused. All of that runs against a receiver on an emulator.
 *
 * Over the LAN transport:
 *
 *   adb forward tcp:47821 tcp:47821
 *   npm run smoke -- <pair-code> [host] [port]
 *
 * Or through the rendezvous relay, which exercises services/relay and the
 * receiver's outbound client at the same time. The room id is derived from the
 * pair code, so there is nothing else to line up:
 *
 *   npm run relay
 *   npm run smoke -- <pair-code> --relay ws://127.0.0.1:8080
 *
 * Give it both and it adds the mirror check: the same envelope, same id, sent
 * down both paths at once, which is what the controller does across a failover
 * and the one case the DedupeWindow exists for.
 *
 * What none of this can tell you is whether a seek lands in the right place.
 * That is still a phone, a video and a pair of eyes.
 */
import { createHmac, createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { canonicalize } from '../packages/protocol/src/codec';
import { DEFAULT_LAN_PORT, PROTOCOL_VERSION } from '../packages/protocol/src/messages';

const args = process.argv.slice(2);
const relayFlag = args.indexOf('--relay');
const relayBase = relayFlag >= 0 ? args[relayFlag + 1] : null;
const positional = args.filter((_a, i) => i !== relayFlag && i !== relayFlag + 1);
const [pairCode, host = '127.0.0.1', portArg] = positional;
const port = Number(portArg ?? DEFAULT_LAN_PORT);

if (!pairCode || (relayFlag >= 0 && !relayBase)) {
  console.error('usage: npm run smoke -- <pair-code> [host] [port] [--relay <ws-url>]');
  process.exit(2);
}

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmacHex = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message, 'utf8').digest('hex');

/** Both must match Codec.kt. If either drifts, every frame below is refused. */
const secret = sha256Hex(`secret:${pairCode}`);
/** Only the room id ever reaches the relay; the secret above never leaves here. */
const room = sha256Hex(`room:${pairCode}`).slice(0, 24);

type AnyEnvelope = Record<string, unknown>;

function sign(body: AnyEnvelope): string {
  const envelope: AnyEnvelope = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now(),
    ...body,
  };
  envelope.sig = hmacHex(secret, canonicalize(envelope as never));
  return JSON.stringify(envelope);
}

function verify(frame: AnyEnvelope): boolean {
  const provided = frame.sig;
  return typeof provided === 'string' && provided === hmacHex(secret, canonicalize(frame as never));
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Link {
  label: string;
  socket: WebSocket;
  inbox: AnyEnvelope[];
}

async function open(label: string, url: string, timeoutMs = 5000): Promise<Link> {
  const socket = new WebSocket(url);
  const inbox: AnyEnvelope[] = [];
  socket.on('message', (data) => {
    try {
      inbox.push(JSON.parse(data.toString()) as AnyEnvelope);
    } catch {
      console.log(`  ...   unparseable frame on ${label}`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no connection within ${timeoutMs}ms`)), timeoutMs);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return { label, socket, inbox };
}

/** Waits for the first frame on a link matching a predicate. */
async function waitFor(
  link: Link,
  predicate: (e: AnyEnvelope) => boolean,
  ms = 4000,
): Promise<AnyEnvelope | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = link.inbox.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) return null;
    await sleep(25);
  }
}

/**
 * Frames that arrived after a mark and are answers to something we sent. The
 * receiver also pushes an unsolicited status event whenever its picture
 * changes; counting those as a reply makes the "expect silence" checks flap.
 */
const responsesSince = (link: Link, mark: number): AnyEnvelope[] =>
  link.inbox.slice(mark).filter((e) => !(e.type === 'event' && e.event === 'status'));

async function exercise(link: Link): Promise<void> {
  console.log(`\n[${link.label}]`);

  // 1 -- ping/pong, the cheapest proof that signing agrees in both directions
  const nonce = randomUUID();
  const sentAt = Date.now();
  link.socket.send(sign({ type: 'ping', nonce }));
  const pong = await waitFor(link, (e) => e.type === 'pong');
  check('receiver answers a signed ping', pong !== null);
  if (pong) {
    check('pong echoes the nonce', pong.nonce === nonce);
    check('pong signature verifies', verify(pong), `${Date.now() - sentAt} ms round trip`);
  }

  // 2 -- device.status, which is also the executor chain's availability report
  link.socket.send(sign({ type: 'cmd', cmd: { op: 'device.status' } }));
  const status = await waitFor(link, (e) => e.type === 'event' && e.event === 'status');
  check('device.status returns an event', status !== null);
  if (status) {
    check('status signature verifies', verify(status));
    const s = status.status as Record<string, unknown> | undefined;
    console.log(`        executors: ${JSON.stringify(s?.executors)}`);
    console.log(`        foreground: ${JSON.stringify(s?.foregroundPackage)}`);
    console.log(`        battery: ${JSON.stringify(s?.batteryPercent)}`);
  }

  // 3 -- a real command. Whether it succeeds depends on what is playing and on
  //      which permissions are granted; what matters here is that an ack comes
  //      back and verifies.
  const seekFrame = sign({ type: 'cmd', cmd: { op: 'playback.seek', deltaMs: 30000 }, critical: true });
  const seekId = (JSON.parse(seekFrame) as AnyEnvelope).id as string;
  link.socket.send(seekFrame);
  const ack = await waitFor(link, (e) => e.type === 'ack' && e.ref === seekId);
  check('seek is acknowledged', ack !== null);
  if (ack) {
    check('ack signature verifies', verify(ack));
    console.log(`        ok=${ack.ok} executedBy=${ack.executedBy} detail=${JSON.stringify(ack.detail)}`);
  }

  // 4 -- the dedupe window on one path
  const mark = link.inbox.length;
  link.socket.send(seekFrame);
  await sleep(1500);
  const repeats = link.inbox.slice(mark).filter((e) => e.type === 'ack' && e.ref === seekId);
  check('a repeated id is dropped', repeats.length === 0,
    repeats.length ? `${repeats.length} extra acks` : 'silence, as intended');

  // 5 -- a forged frame
  const forgedMark = link.inbox.length;
  link.socket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now(),
    type: 'cmd',
    cmd: { op: 'playback.seek', deltaMs: 999000 },
    sig: 'deadbeef'.repeat(8),
  }));
  await sleep(1500);
  check('a bad signature gets no reply at all', responsesSince(link, forgedMark).length === 0);

  // 6 -- a frame from too far in the past
  const stale: AnyEnvelope = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now() - 120_000,
    type: 'cmd',
    cmd: { op: 'device.status' },
  };
  stale.sig = hmacHex(secret, canonicalize(stale as never));
  const staleMark = link.inbox.length;
  link.socket.send(JSON.stringify(stale));
  await sleep(1500);
  check('a frame outside the skew window is ignored', responsesSince(link, staleMark).length === 0);
}

/**
 * The mirror. With mirrorCritical on, the controller puts the same envelope down
 * two transports at once during a failover; exactly one of them must execute.
 * This is the check that a "+30s" pressed once never jumps 60.
 */
async function mirror(a: Link, b: Link): Promise<void> {
  console.log(`\n[mirror: ${a.label} + ${b.label}]`);
  const frame = sign({ type: 'cmd', cmd: { op: 'playback.seek', deltaMs: 30000 }, critical: true });
  const id = (JSON.parse(frame) as AnyEnvelope).id as string;
  const marks = [a.inbox.length, b.inbox.length] as const;

  a.socket.send(frame);
  b.socket.send(frame);
  await sleep(2500);

  const acks = [
    ...a.inbox.slice(marks[0]).filter((e) => e.type === 'ack' && e.ref === id),
    ...b.inbox.slice(marks[1]).filter((e) => e.type === 'ack' && e.ref === id),
  ];
  check('the same command on both paths executes once', acks.length === 1,
    `${acks.length} ack${acks.length === 1 ? '' : 's'}`);
}

async function main(): Promise<void> {
  const links: Link[] = [];

  if (relayBase) {
    const url = `${relayBase.replace(/\/+$/, '')}/room/${room}?role=controller`;
    console.log(`\nrelay path: ${url}`);
    links.push(await open('relay', url));
  }

  const lanUrl = `ws://${host}:${port}/ctl`;
  if (relayBase) {
    // Best effort when a relay was named: the mirror check needs both, but a
    // relay-only run is still worth doing.
    try {
      links.push(await open('lan', lanUrl, 2500));
      console.log(`lan path:   ${lanUrl}`);
    } catch {
      console.log(`lan path:   unavailable (${lanUrl}) — skipping the mirror check`);
    }
  } else {
    console.log(`\nlan path: ${lanUrl}`);
    links.push(await open('lan', lanUrl));
  }

  for (const link of links) await exercise(link);
  if (links.length === 2) await mirror(links[0]!, links[1]!);

  for (const link of links) link.socket.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`\nsmoke test could not run: ${(error as Error).message}`);
  console.error('Is the receiver up and paired with this code?');
  console.error('  LAN:   adb forward tcp:47821 tcp:47821');
  console.error('  relay: npm run relay, and set the relay URL on the receiver');
  process.exit(2);
});
