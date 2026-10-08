/**
 * Fire one command at a receiver over the LAN path and print the reply.
 * Handy for poking at recipes on a device without the controller app.
 *
 *   adb forward tcp:47821 tcp:47821
 *   npm run send -- <pair-code> fullscreen.enter '{"toggle":true}'
 *   npm run send -- <pair-code> fullscreen.exit
 *   npm run send -- <pair-code> device.status
 *   npm run send -- <pair-code> device.status '{"includeNavItems":true}'
 *   npm run send -- <pair-code> nav.step '{"delta":-1}'
 *   npm run send -- <pair-code> nav.goto '{"index":2,"label":"3"}'
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { canonicalize } from '../packages/protocol/src/codec';
import { DEFAULT_LAN_PORT, PROTOCOL_VERSION } from '../packages/protocol/src/messages';

const [pairCode, op, extra, host = '127.0.0.1'] = process.argv.slice(2);
if (!pairCode || !op) {
  console.error("usage: npm run send -- <pair-code> <op> ['{json args}'] [host]");
  process.exit(2);
}

const secret = createHash('sha256').update(`secret:${pairCode}`).digest('hex');
const env: Record<string, unknown> = {
  v: PROTOCOL_VERSION,
  id: randomUUID(),
  ts: Date.now(),
  type: 'cmd',
  cmd: { op, ...(extra ? (JSON.parse(extra) as object) : {}) },
};
env.sig = createHmac('sha256', secret).update(canonicalize(env as never)).digest('hex');

const socket = new WebSocket(`ws://${host}:${DEFAULT_LAN_PORT}/ctl`);
const timer = setTimeout(() => {
  console.error('no reply within 15 s');
  process.exit(1);
}, 15_000);

socket.on('open', () => socket.send(JSON.stringify(env)));
socket.on('message', (data) => {
  const reply = JSON.parse(data.toString()) as Record<string, unknown>;
  // Status events carry no ref, and the receiver also broadcasts one whenever
  // its picture changes; a broadcast never has nav.items, so when they were
  // asked for, wait for the status that has them (or has no nav at all).
  const status = reply.status as { nav?: { items?: unknown } } | undefined;
  const wantsItems = (env.cmd as { includeNavItems?: boolean }).includeNavItems === true;
  const isAnswer =
    (reply.type === 'ack' && reply.ref === env.id) ||
    (op === 'device.status' && reply.type === 'event' && reply.event === 'status' &&
      (!wantsItems || !status?.nav || status.nav.items !== undefined));
  if (!isAnswer) return;
  clearTimeout(timer);
  console.log(JSON.stringify(reply.type === 'ack' ? { ok: reply.ok, executedBy: reply.executedBy, detail: reply.detail, tookMs: reply.tookMs } : reply.status, null, 2));
  socket.close();
  process.exit(reply.type === 'ack' && !reply.ok ? 1 : 0);
});
socket.on('error', (e) => {
  console.error(e.message);
  process.exit(2);
});
