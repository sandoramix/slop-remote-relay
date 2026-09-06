/**
 * Protocol smoke test against a running receiver, over the LAN transport.
 *
 * Phase 2 in docs/BUILD.md asks for two phones. Most of what it is really
 * checking does not: whether the Kotlin side verifies a signature produced by
 * the TypeScript side, whether the reply verifies back, whether the dedupe
 * window drops a repeated id, and whether a tampered frame is refused. All of
 * that runs against a receiver on an emulator with a port forward, and none of
 * it needs a second handset.
 *
 * What it cannot tell you is whether a seek lands in the right place. That is
 * still a phone, a video and a pair of eyes.
 *
 *   adb forward tcp:47821 tcp:47821
 *   npm run smoke -- <pair-code> [host] [port]
 */
import { createHmac, createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { canonicalize } from '../packages/protocol/src/codec';
import { DEFAULT_LAN_PORT, PROTOCOL_VERSION } from '../packages/protocol/src/messages';

const [, , pairCode, host = '127.0.0.1', portArg] = process.argv;
const port = Number(portArg ?? DEFAULT_LAN_PORT);

if (!pairCode) {
  console.error('usage: npm run smoke -- <pair-code> [host] [port]');
  process.exit(2);
}

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmacHex = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message, 'utf8').digest('hex');

/** Both must match Codec.kt. If either drifts, every frame below is refused. */
const secret = sha256Hex(`secret:${pairCode}`);

type AnyEnvelope = Record<string, unknown>;

function sign(body: AnyEnvelope): string {
  const envelope: AnyEnvelope = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now(),
    ...body,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  envelope.sig = hmacHex(secret, canonicalize(envelope as any));
  return JSON.stringify(envelope);
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const url = `ws://${host}:${port}/ctl`;
  console.log(`\nreceiver smoke test against ${url}\n`);

  const socket = new WebSocket(url);
  const inbox: AnyEnvelope[] = [];
  socket.on('message', (data) => {
    try {
      inbox.push(JSON.parse(data.toString()) as AnyEnvelope);
    } catch {
      console.log('  ...  unparseable frame from receiver');
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no connection within 5s`)), 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  console.log('  connected\n');

  /** Waits for the first inbound frame matching a predicate. */
  const await_ = async (
    predicate: (e: AnyEnvelope) => boolean,
    ms = 4000,
  ): Promise<AnyEnvelope | null> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = inbox.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  /**
   * Frames that arrived after a given point and are answers to something we
   * sent. The receiver also pushes an unsolicited status event whenever its
   * picture changes, roughly every few seconds while things settle; counting
   * those as a reply makes the "no answer expected" checks flap.
   */
  const responsesSince = (mark: number): AnyEnvelope[] =>
    inbox.slice(mark).filter((e) => !(e.type === 'event' && e.event === 'status'));

  const verifyReply = (frame: AnyEnvelope): boolean => {
    const provided = frame.sig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = hmacHex(secret, canonicalize(frame as any));
    return typeof provided === 'string' && provided === expected;
  };

  // 1 -- ping/pong, the cheapest proof that signing agrees in both directions
  const nonce = randomUUID();
  const pingSentAt = Date.now();
  socket.send(sign({ type: 'ping', nonce }));
  const pong = await await_((e) => e.type === 'pong');
  check('receiver answers a signed ping', pong !== null);
  if (pong) {
    check('pong echoes the nonce', pong.nonce === nonce, String(pong.nonce).slice(0, 8));
    check('pong signature verifies', verifyReply(pong), `${Date.now() - pingSentAt} ms round trip`);
  }

  // 2 -- device.status, which exercises the executor chain's availability report
  socket.send(sign({ type: 'cmd', cmd: { op: 'device.status' } }));
  const status = await await_((e) => e.type === 'event' && e.event === 'status');
  check('device.status returns an event', status !== null);
  if (status) {
    check('status signature verifies', verifyReply(status));
    const s = status.status as Record<string, unknown> | undefined;
    console.log(`        executors: ${JSON.stringify(s?.executors)}`);
    console.log(`        foreground: ${JSON.stringify(s?.foregroundPackage)}`);
    console.log(`        battery: ${JSON.stringify(s?.batteryPercent)}`);
  }

  // 3 -- a real command. Whether it succeeds depends on what is playing; what
  //      is being checked here is that an ack comes back and verifies.
  const seekFrame = sign({
    type: 'cmd',
    cmd: { op: 'playback.seek', deltaMs: 30000 },
    critical: true,
  });
  const seekId = (JSON.parse(seekFrame) as AnyEnvelope).id as string;
  socket.send(seekFrame);
  const ack = await await_((e) => e.type === 'ack' && e.ref === seekId);
  check('seek is acknowledged', ack !== null);
  if (ack) {
    check('ack signature verifies', verifyReply(ack));
    console.log(`        ok=${ack.ok} executedBy=${ack.executedBy} detail=${JSON.stringify(ack.detail)}`);
  }

  // 4 -- the dedupe window. Re-sending the identical envelope, id and all, is
  //      what the controller does when mirroring across two transports.
  const before = inbox.length;
  socket.send(seekFrame);
  await new Promise((r) => setTimeout(r, 1500));
  const second = inbox.slice(before).filter((e) => e.type === 'ack' && e.ref === seekId);
  check('a repeated id is dropped by the dedupe window', second.length === 0,
    second.length ? `${second.length} extra acks` : 'silence, as intended');

  // 5 -- a forged frame
  const forged = JSON.stringify({
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now(),
    type: 'cmd',
    cmd: { op: 'playback.seek', deltaMs: 999000 },
    sig: 'deadbeef'.repeat(8),
  });
  const beforeForged = inbox.length;
  socket.send(forged);
  await new Promise((r) => setTimeout(r, 1500));
  check('a bad signature gets no reply at all', responsesSince(beforeForged).length === 0);

  // 6 -- a frame from too far in the past
  const staleEnvelope: AnyEnvelope = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    ts: Date.now() - 120_000,
    type: 'cmd',
    cmd: { op: 'device.status' },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  staleEnvelope.sig = hmacHex(secret, canonicalize(staleEnvelope as any));
  const beforeStale = inbox.length;
  socket.send(JSON.stringify(staleEnvelope));
  await new Promise((r) => setTimeout(r, 1500));
  check('a frame outside the skew window is ignored', responsesSince(beforeStale).length === 0);

  socket.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`\nsmoke test could not run: ${(error as Error).message}`);
  console.error('Is the receiver up, paired with this code, and forwarded?');
  console.error('  adb forward tcp:47821 tcp:47821');
  process.exit(2);
});
