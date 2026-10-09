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
  async status(includeNavItems = false) {
    // Status replies carry no ref; drop pushes queued earlier so the answer is to this request.
    this.inbox = this.inbox.filter((e) => !(e.type === 'event' && e.event === 'status'));
    await this.transport.send(sign({ type: 'cmd', cmd: { op: 'device.status', ...(includeNavItems ? { includeNavItems } : {}) } }));
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
  const page = createServer((q, s) => {
    s.writeHead(200, { 'content-type': 'text/html' });
    // /play/<series>/<n>: markup shaped like AnimeWorld's, with the episodes
    // in hidden ranges of 50, which is what a long series looks like there.
    const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
    // The player AnimeWorld puts in an iframe once its cover is clicked: not autoplaying.
    if ((q.url ?? '').startsWith('/api/episode/')) {
      s.end(`<!doctype html><body style="margin:0"><video controls style="width:100%;height:100%" src="${VIDEO}"></video>`);
      return;
    }
    // An ad banner from another origin, playing a video of its own.
    if (q.url === '/ad') {
      s.end(`<!doctype html><body style="margin:0"><video muted loop autoplay style="width:300px;height:250px" src="${VIDEO}"></video>`);
      return;
    }
    // /play/cold.x/<n>[?noad]: the player is a cover until clicked, like AnimeWorld's
    // (#player.player-box > #player-cover.cover; the click swaps in #player-iframe).
    // /play/broken.x/<n>: no cover, no video.
    const cold = /^\/play\/(cold|broken)\.x\/(\d+)(\?noad)?$/.exec(q.url ?? '');
    if (cold) {
      const ad = cold[3] ? '' : `<iframe src="http://127.0.0.1:${PAGE_PORT}/ad" style="width:300px;height:250px;border:0"></iframe>`;
      const player = cold[1] === 'broken' ? '<div id="player" class="player-box"></div>' : `
        <div id="player" class="player-box" style="width:640px;height:360px">
          <div class="cover" id="player-cover" style="width:100%;height:100%;background:#333;cursor:pointer"></div>
        </div>
        <script>
          document.getElementById('player-cover').addEventListener('click', () => {
            window.open('/ad', '_blank');
            setTimeout(() => {
              document.getElementById('player-cover').remove();
              const f = document.createElement('iframe');
              f.id = 'player-iframe';
              f.src = '/api/episode/serverPlayerAnimeWorld?id=${cold[2]}';
              f.allow = 'autoplay;fullscreen';
              f.allowFullscreen = true;
              f.style.cssText = 'width:100%;height:100%;border:0';
              document.getElementById('player').appendChild(f);
            }, 800);
          });
        </script>`;
      s.end(`<!doctype html><title>Cold episode ${cold[2]}</title><body>
        <div class="server active"><ul class="episodes"><li class="episode"><a data-episode-num="${cold[2]}" class="active" href="/play/${cold[1]}.x/${cold[2]}">${cold[2]}</a></li></ul></div>
        ${player}${ad}`);
      return;
    }
    const ep = /^\/play\/[^/]+\/(\d+)$/.exec(q.url ?? '');
    if (ep) {
      const lis = Array.from({ length: 120 }, (_, i) => i + 1).map((n) =>
        `<li class="episode"><a data-episode-num="${n}" href="/play/test.x/${n}"${n === Number(ep[1]) ? ' class="active"' : ''}>${n}</a></li>`);
      const ranges = [0, 1, 2].map((r) => `<ul class="episodes range ${r === 0 ? 'active' : 'hidden'}" data-range-id="${r}">${lis.slice(r * 50, r * 50 + 50).join('')}</ul>`);
      s.end(`<!doctype html><title>Episode ${ep[1]}</title><body><style>.hidden{display:none}</style>
        <div class="server active">${ranges.join('')}</div>
        <video controls muted loop autoplay style="width:320px" src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"></video>`);
      return;
    }
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
    enableExtensions: true,
    // animeworld.ac resolves to the test page, so the shipped nav plan for that
    // host is what gets exercised, not a copy of it.
    args: ['--autoplay-policy=no-user-gesture-required', `--host-resolver-rules=MAP animeworld.ac 127.0.0.1`],
  });
  // Loaded over CDP rather than --load-extension, so step 3 can uninstall it.
  await browser.installExtension(ext);
  const workerTarget = await browser.waitForTarget((t) => t.type() === 'service_worker');
  const worker = await workerTarget.worker();
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

  // 2b -- episode navigation, driven by the shipped plan for animeworld.ac
  console.log('\n[episode navigation]');
  const navTab = await browser.newPage();
  const epUrl = (n: number) => `http://animeworld.ac:${PAGE_PORT}/play/test.x/${n}`;
  const landedOn = async (n: number) => {
    await navTab.waitForFunction((u) => location.href === u, { timeout: 8000 }, epUrl(n)).catch(() => undefined);
    return navTab.url() === epUrl(n);
  };
  await navTab.goto(epUrl(60));
  await navTab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await navTab.bringToFront();
  await sleep(1500);
  const nc = new Controller(new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' }));
  await nc.connect();
  const ns = (await nc.status()) as { nav?: { current: string; hasPrev: boolean; hasNext: boolean; count: number; items?: string[] } } | null;
  check('status carries nav, without the list', ns?.nav?.current === '60' && ns.nav.count === 120 && ns.nav.hasPrev && ns.nav.hasNext && !ns.nav.items,
    JSON.stringify(ns?.nav));
  const full = (await nc.status(true)) as { nav?: { items?: string[] } } | null;
  check('status lists every episode on request, hidden ranges included', full?.nav?.items?.length === 120 && full.nav.items[99] === '100');
  const next = await nc.cmd({ op: 'nav.step', delta: 1 });
  check('next episode', !!next?.ok && (await landedOn(61)), `${next?.detail}`);
  await navTab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await sleep(1000);
  const prev = await nc.cmd({ op: 'nav.step', delta: -1 });
  check('previous episode', !!prev?.ok && (await landedOn(60)), `${prev?.detail}`);
  await sleep(1500);
  const go = await nc.cmd({ op: 'nav.goto', index: 99, label: '100' });
  check('goto an episode in a hidden range', !!go?.ok && (await landedOn(100)), `${go?.detail}`);
  await sleep(1500);
  const stale = await nc.cmd({ op: 'nav.goto', index: 5, label: '999' });
  check('goto refuses a list that changed', stale?.ok === false && String(stale.detail).includes('changed'), `${stale?.detail}`);
  await navTab.goto(epUrl(120));
  await navTab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await sleep(1500);
  const end = await nc.cmd({ op: 'nav.step', delta: 1 });
  check('no next after the last episode', end?.ok === false && String(end.detail).includes('last'), `${end?.detail}`);
  await nc.transport.close();
  await navTab.close();

  // 2c -- a player kept behind a cover, started by the shipped start plan for animeworld.ac
  console.log('\n[cold player]');
  const cc = new Controller(new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' }));
  await cc.connect();
  const coldTab = await browser.newPage();
  const coldUrl = (n: number, ad = true) => `http://animeworld.ac:${PAGE_PORT}/play/cold.x/${n}${ad ? '' : '?noad'}`;
  const openCold = async (url: string) => {
    await coldTab.goto(url);
    await coldTab.bringToFront();
    await sleep(1500);
  };
  const frameVideo = async (part: string) =>
    coldTab.frames().find((f) => f.url().includes(part))
      ?.evaluate(() => { const v = document.querySelector('video')!; return { paused: v.paused, t: v.currentTime }; })
      .catch(() => null) ?? null;
  const hasPlayer = async () => !!(await coldTab.$('#player-iframe'));

  await openCold(coldUrl(1));
  const cs = (await cc.status()) as { nav?: { current: string } } | null;
  check('status works before the player is started, and does not start it', cs?.nav?.current === '1' && !(await hasPlayer()), JSON.stringify(cs?.nav));
  const pagesBefore = (await browser.pages()).length;
  const start = await cc.cmd({ op: 'playback.playPause' });
  await sleep(500);
  const started = await frameVideo('/api/episode/');
  check('playPause on a cold page starts the player and plays it', !!start?.ok && String(start.detail).includes('started the player') && started?.paused === false,
    `${start?.detail}`);
  const pagesAfter = (await browser.pages()).length;
  check('no popup tab left open by the start click', pagesAfter === pagesBefore, `${pagesBefore} → ${pagesAfter} pages`);
  const coldPause = await cc.cmd({ op: 'playback.playPause', play: false });
  await sleep(300);
  const [player, ad] = [await frameVideo('/api/episode/'), await frameVideo('/ad')];
  check('pause reaches the player, not the ad playing beside it', !!coldPause?.ok && player?.paused === true && ad?.paused === false,
    `player paused=${player?.paused} ad paused=${ad?.paused} — ${coldPause?.detail}`);

  await openCold(coldUrl(2, false));
  const coldSeek = await cc.cmd({ op: 'playback.seekTo', positionMs: 3000 });
  let seekedTo = -1;
  for (let i = 0; i < 20 && Math.abs(seekedTo - 3) >= 0.8; i++) {
    await sleep(250);
    seekedTo = (await frameVideo('/api/episode/'))?.t ?? -1;
  }
  check('seekTo on a cold page starts the player and seeks', !!coldSeek?.ok && Math.abs(seekedTo - 3) < 0.8, `${seekedTo.toFixed(1)}s — ${coldSeek?.detail}`);

  await openCold(coldUrl(3, false));
  const coldFs = await cc.cmd({ op: 'fullscreen.enter', toggle: true });
  const fsEl = await coldTab.evaluate(() => document.fullscreenElement?.id ?? null);
  check('fullscreen on a cold page starts the player and enters', !!coldFs?.ok && fsEl === 'player-iframe', `${fsEl} — ${coldFs?.executedBy} ${coldFs?.detail}`);
  const fsStatus = await cc.status();
  check('status reports fullscreen when the player is an iframe', fsStatus?.fullscreen === true, `${fsStatus?.fullscreen}`);
  const fsOut = await cc.cmd({ op: 'fullscreen.enter', toggle: true });
  await sleep(300);
  check('toggling leaves fullscreen of a player iframe', !!fsOut?.ok && !(await coldTab.evaluate(() => !!document.fullscreenElement)), `${fsOut?.detail}`);

  await openCold(coldUrl(4));
  const coldNav = await cc.cmd({ op: 'nav.step', delta: 1 });
  const coldExit = await cc.cmd({ op: 'fullscreen.exit' });
  check('nav and fullscreen.exit never start the player', !!coldNav && !!coldExit && !(await hasPlayer()), `${coldNav?.detail} / ${coldExit?.detail}`);

  await openCold(`http://animeworld.ac:${PAGE_PORT}/play/broken.x/1`);
  const broken = await cc.cmd({ op: 'playback.playPause' });
  check('no start control: a clear failure, not the ad beside it', broken?.ok === false && String(broken.detail).includes('no start control'), `${broken?.detail}`);
  await cc.transport.close();
  await coldTab.close();
  await tab.bringToFront();

  // 3 -- a tab that was already open when the extension was installed: the
  // manifest never injects into it, and what is left of the previous copy's
  // content script is orphaned. Same key, so the reinstall keeps the same id.
  console.log('\n[tab open before install]');
  const extId = new URL(workerTarget.url()).hostname;
  await browser.uninstallExtension(extId);
  await sleep(500);
  await browser.installExtension(ext);
  const w2 = await (
    await browser.waitForTarget((t) => t.type() === 'service_worker' && t !== workerTarget, { timeout: 15_000 })
  ).worker();
  await w2!.evaluate(
    (settings) => chrome.storage.local.set({ settings }),
    { pairCode, relayUrl: `ws://127.0.0.1:${RELAY_PORT}`, mqttUrl: '', disabled: [] },
  );
  await sleep(3000);
  const c = new Controller(new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' }));
  await c.connect();
  const status = await c.status();
  check('status still names the open page', String(status?.foregroundPackage ?? '').includes(String(PAGE_PORT)),
    `${status?.foregroundPackage}`);
  const pause = await c.cmd({ op: 'playback.playPause', play: false });
  const paused = await tab.evaluate(() => document.querySelector('video')!.paused);
  check('pause reaches the open page', !!pause?.ok && paused, `${pause?.detail}`);
  await c.transport.close();

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
