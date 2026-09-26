/**
 * End-to-end test of the browser extension receiver, no phone involved.
 *
 * Starts a relay, launches Chrome for Testing with the built extension, pairs
 * it by writing its settings, opens a page with a video, and drives it with the
 * controller's own transport classes over relay WS, relay HTTP and WebRTC.
 *
 *   npm run build -w @relay/browser-extension
 *   npm run smoke:extension
 *
 * The build is loaded exactly as shipped. An earlier version of this test
 * patched the manifest to make `debugger` required, which hid the fact that
 * Chrome silently drops `debugger` from optional_permissions — the real
 * extension could never enter fullscreen. The test also asserts the shipped
 * manifest actually grants it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { canonicalize } from '../packages/protocol/src/codec';
import { PROTOCOL_VERSION } from '../packages/protocol/src/messages';
import type { Transport } from '../packages/protocol/src/transport';
import {
  RelayHttpTransport,
  RelayWsTransport,
  WebRtcTransport,
  type PeerConnectionFactory,
} from '../packages/transports/src/index';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const RELAY_PORT = 18181;
const PAGE_PORT = 18182;
const pairCode = `test-${randomUUID()}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = sha(`secret:${pairCode}`);
const room = sha(`room:${pairCode}`).slice(0, 24);
const hmac = async (m: string) => createHmac('sha256', secret).update(m).digest('hex');

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sign(body: Record<string, unknown>): string {
  const env: Record<string, unknown> = { v: PROTOCOL_VERSION, id: randomUUID(), ts: Date.now(), ...body };
  env.sig = createHmac('sha256', secret).update(canonicalize(env as never)).digest('hex');
  return JSON.stringify(env);
}

class Controller {
  inbox: Array<Record<string, unknown>> = [];
  constructor(readonly transport: Transport) {}
  async connect() {
    await this.transport.connect({
      onMessage: (raw) => this.inbox.push(JSON.parse(raw) as Record<string, unknown>),
      onStateChange: () => undefined,
    });
  }
  async wait(pred: (e: Record<string, unknown>) => boolean, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0]!;
      await sleep(25);
    }
    return null;
  }
  async cmd(cmd: Record<string, unknown>) {
    const frame = sign({ type: 'cmd', cmd });
    const id = (JSON.parse(frame) as { id: string }).id;
    await this.transport.send(frame);
    return this.wait((e) => e.type === 'ack' && e.ref === id, 12_000);
  }
  async status() {
    await this.transport.send(sign({ type: 'cmd', cmd: { op: 'device.status' } }));
    const e = await this.wait((x) => x.type === 'event' && x.event === 'status');
    return (e?.status ?? null) as Record<string, unknown> | null;
  }
}

async function main(): Promise<void> {
  // 1 -- relay and a page with a video
  const relay: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'services/relay/src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const page = createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(`<!doctype html><title>Relay extension test</title><body style="margin:0;background:#000">
      <div id="player" style="width:640px"><video controls muted loop autoplay style="width:100%"
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"></video></div>`);
  }).listen(PAGE_PORT);
  await sleep(2000);

  // 2 -- the extension, untouched
  const ext = mkdtempSync(path.join(tmpdir(), 'relay-ext-'));
  cpSync(path.join(root, 'apps/browser-extension/dist'), ext, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker')).worker();
  const granted = (await worker!.evaluate(() => chrome.permissions.getAll())) as { permissions?: string[] };
  check('shipped manifest grants debugger (needed for fullscreen)', !!granted.permissions?.includes('debugger'));
  await worker!.evaluate(
    (settings) => chrome.storage.local.set({ settings }),
    { pairCode, relayUrl: `ws://127.0.0.1:${RELAY_PORT}`, mqttUrl: '', disabled: [] },
  );
  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await tab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await sleep(3000); // the offscreen document dials every path

  const { RTCPeerConnection } = (await import('node-datachannel/polyfill')) as unknown as {
    RTCPeerConnection: new (c: unknown) => ReturnType<PeerConnectionFactory>;
  };
  const paths: Array<[string, Transport]> = [
    ['relay', new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' })],
    ['http', new RelayHttpTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' })],
    [
      'webrtc',
      new WebRtcTransport({
        signalUrl: `ws://127.0.0.1:${RELAY_PORT}`,
        room,
        role: 'controller',
        createPeerConnection: (c) => new RTCPeerConnection(c),
        hmac,
        stunUrls: [],
      }),
    ],
  ];

  for (const [label, transport] of paths) {
    console.log(`\n[${label}]`);
    const c = new Controller(transport);
    try {
      await c.connect();
    } catch (e) {
      check('connects', false, (e as Error).message);
      continue;
    }
    const status = await c.status();
    check('status names the page', typeof status?.foregroundPackage === 'string' && String(status.foregroundPackage).includes(String(PAGE_PORT)),
      `${status?.foregroundPackage} executors=${JSON.stringify(status?.executors)}`);

    const before = Number(await tab.evaluate(() => document.querySelector('video')!.currentTime));
    const seek = await c.cmd({ op: 'playback.seekTo', positionMs: 3000 });
    await sleep(300);
    const after = Number(await tab.evaluate(() => document.querySelector('video')!.currentTime));
    check('seekTo 3 s', !!seek?.ok && Math.abs(after - 3) < 0.8, `${before.toFixed(1)}s → ${after.toFixed(1)}s`);

    const pause = await c.cmd({ op: 'playback.playPause', play: false });
    const paused = await tab.evaluate(() => document.querySelector('video')!.paused);
    check('pause', !!pause?.ok && paused);
    await c.cmd({ op: 'playback.playPause', play: true });

    const fs = await c.cmd({ op: 'fullscreen.enter', toggle: true });
    const isFs = await tab.evaluate(() => !!document.fullscreenElement);
    check('fullscreen enter (cdp)', !!fs?.ok && isFs, `${fs?.executedBy} ${fs?.detail}`);

    const exit = await c.cmd({ op: 'fullscreen.exit' });
    await sleep(300);
    const stillFs = await tab.evaluate(() => !!document.fullscreenElement);
    check('fullscreen exit (dom)', !!exit?.ok && !stillFs, `${exit?.executedBy} ${exit?.detail}`);

    await transport.close();
  }

  await browser.close();
  relay.kill();
  page.close();
  const ndc = (await import('node-datachannel')) as unknown as { cleanup?: () => void; default?: { cleanup?: () => void } };
  (ndc.cleanup ?? ndc.default?.cleanup)?.();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
