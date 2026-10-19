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
import { DEFAULT_MQTT_URL, PROTOCOL_VERSION } from '../packages/protocol/src/messages';
import type { Transport } from '../packages/protocol/src/transport';
import {
  MqttTransport,
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

  // 2d -- the skip panel: shortcuts, overlay and toast, in the page, next to a connected phone
  console.log('\n[skip panel]');
  const setPanel = async (panel: Record<string, unknown>) => {
    await worker!.evaluate((p) => chrome.storage.local.set({ panel: p }), panel as never);
    await sleep(400);
  };
  const BASE = { overlay: 'hover', keys: true, toast: true, presets: [1, 2, 5], selected: 2, offHosts: [] as string[] };
  const press = async (p: typeof tab, combo: string[], key: string) => {
    for (const m of combo) await p.keyboard.down(m);
    await p.keyboard.press(key as never);
    for (const m of [...combo].reverse()) await p.keyboard.up(m);
    await sleep(500);
  };
  const at = (p: typeof tab) => p.evaluate(() => document.querySelector('video')!.currentTime);
  const park = (p: typeof tab, t: number) =>
    p.evaluate((x) => { const v = document.querySelector('video')!; v.pause(); v.currentTime = x; }, t);
  const pillOn = (p: typeof tab, side: 'l' | 'r' = 'r') =>
    p.evaluate((sd) => document.querySelector('[data-skipper]')?.shadowRoot?.querySelector(`.side.${sd} .handle`)?.classList.contains('on') ?? false, side);
  const floatText = (p: typeof tab) =>
    p.evaluate(() => document.querySelector('[data-skipper]')?.shadowRoot?.querySelector('.side.r .float')?.textContent ?? '');
  const savedPanel = async () =>
    ((await worker!.evaluate(() => chrome.storage.local.get('panel'))) as { panel?: { selected?: number; overlay?: string } }).panel ?? {};

  const pc = new Controller(new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' }));
  await pc.connect();
  await tab.bringToFront();
  await setPanel(BASE);
  await park(tab, 1);
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  const fwd = await at(tab);
  check('Alt+Shift+→ jumps forward by the selected amount', Math.abs(fwd - 3) < 0.5, `1.0s → ${fwd.toFixed(1)}s`);
  await press(tab, ['Alt', 'Shift'], 'ArrowLeft');
  const back = await at(tab);
  check('Alt+Shift+← jumps back', Math.abs(back - 1) < 0.5, `→ ${back.toFixed(1)}s`);
  await park(tab, 0);
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  check('quick jumps add up in the number shown', (await floatText(tab)) === '+4s', await floatText(tab));
  await park(tab, 1);
  await press(tab, [], 'ArrowRight');
  check('a bare arrow is left to the site', Math.abs((await at(tab)) - back) < 0.3);

  await press(tab, ['Alt', 'Shift'], 'ArrowUp');
  const stored = (await worker!.evaluate(() => chrome.storage.local.get('panel'))) as { panel?: { selected?: number } };
  check('Alt+Shift+↑ picks the next amount and saves it', stored.panel?.selected === 5, `selected=${stored.panel?.selected}`);
  await setPanel(BASE);

  // The phone keeps working beside it, and sees a jump made at the keyboard.
  await park(tab, 1);
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  const seen = await pc.status();
  check('the phone sees a jump made at the keyboard', Math.abs(Number(seen?.positionMs) - 3000) < 600, `positionMs=${seen?.positionMs}`);
  const viaPhone = await pc.cmd({ op: 'playback.seekTo', positionMs: 4000 });
  await sleep(300);
  check('the phone still seeks after panel jumps', !!viaPhone?.ok && Math.abs((await at(tab)) - 4) < 0.5, `${viaPhone?.detail}`);

  // Overlay
  await park(tab, 1);
  await tab.mouse.move(300, 200);
  await tab.mouse.move(320, 210);
  await sleep(500);
  check('both pills slide in when the pointer is over the video', (await pillOn(tab, 'l')) && (await pillOn(tab, 'r')));
  const box = await tab.evaluate(() => {
    const r = document.querySelector('[data-skipper]')!.shadowRoot!.querySelector('.side.r .handle')!.getBoundingClientRect();
    const v = document.querySelector('video')!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, vRight: v.right, vMid: v.top + v.height / 2 };
  });
  check('the forward pill sits on the right edge, vertically centred', box.vRight - box.right < 30 && Math.abs(box.y - box.vMid) < 6,
    `${(box.vRight - box.right).toFixed(0)} px from the edge, ${(box.y - box.vMid).toFixed(0)} px off centre`);
  await tab.mouse.move(box.x, box.y);
  await tab.mouse.click(box.x, box.y);
  await sleep(500);
  check('clicking the forward pill jumps', Math.abs((await at(tab)) - 3) < 0.5, `${(await at(tab)).toFixed(1)}s`);
  check('the jump floats up beside the pill', (await floatText(tab)) === '+2s', await floatText(tab));
  await tab.mouse.move(box.x, box.y + 2);
  await sleep(300);
  await tab.mouse.wheel({ deltaY: -100 });
  await sleep(500);
  check('the wheel over a pill picks the next amount', (await savedPanel()).selected === 5, `selected=${(await savedPanel()).selected}`);
  await setPanel(BASE);
  await tab.mouse.move(box.x, box.y - 2);
  await sleep(300);
  await tab.mouse.move(900, 600);
  await sleep(3400);
  check('the pills slide away on their own', !(await pillOn(tab)) && !(await pillOn(tab, 'l')));

  // Fullscreen: the pill must be inside the fullscreen element to be seen
  const fsPhone = await pc.cmd({ op: 'fullscreen.enter', toggle: true });
  await tab.mouse.move(300, 300);
  await tab.mouse.move(310, 310);
  await sleep(600);
  const parentId = await tab.evaluate(() => document.querySelector('[data-skipper]')?.parentElement?.id ?? null);
  check('in fullscreen the pills live inside the fullscreen element', !!fsPhone?.ok && parentId === 'player', `parent=${parentId} ${fsPhone?.detail}`);
  await pc.cmd({ op: 'fullscreen.exit' });
  await sleep(500);

  // Switching it off
  await press(tab, ['Alt', 'Shift'], 'KeyS');
  check('Alt+Shift+S switches the overlay off', (await savedPanel()).overlay === 'off', `${(await savedPanel()).overlay}`);
  await tab.mouse.move(100, 100);
  await tab.mouse.move(120, 120);
  await sleep(500);
  check('with the overlay off the pills stay away', !(await pillOn(tab)) && !(await pillOn(tab, 'l')));
  await setPanel({ ...BASE, offHosts: ['127.0.0.1'] });
  await park(tab, 1);
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  check('a site on the off list ignores the shortcuts', Math.abs((await at(tab)) - 1) < 0.3);
  await setPanel({ ...BASE, keys: false });
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  check('shortcuts can be switched off', Math.abs((await at(tab)) - 1) < 0.3);
  await setPanel(BASE);

  // A player inside an iframe, with the keys pressed in the page around it
  await tab.goto(`http://animeworld.ac:${PAGE_PORT}/play/cold.x/5?noad`);
  await sleep(1500);
  await pc.cmd({ op: 'playback.playPause' });
  await sleep(800);
  const playerFrame = () => tab.frames().find((f) => f.url().includes('/api/episode/'));
  await playerFrame()?.evaluate(() => { const v = document.querySelector('video')!; v.pause(); v.currentTime = 1; });
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  const inFrame = (await playerFrame()?.evaluate(() => document.querySelector('video')!.currentTime)) ?? -1;
  check('a shortcut pressed in the page jumps the video in its iframe', Math.abs(inFrame - 3) < 0.6, `${inFrame.toFixed(1)}s`);
  await tab.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await tab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  // 2e -- the choice of style, the picker, the one-time tip, and the three other styles
  console.log('\n[skip panel styles]');
  const hasCls = (sel: string, cls: string) =>
    tab.evaluate((s, c) => document.querySelector('[data-skipper]')?.shadowRoot?.querySelector(s)?.classList.contains(c) ?? false, sel, cls);
  const text = (sel: string) =>
    tab.evaluate((s) => document.querySelector('[data-skipper]')?.shadowRoot?.querySelector(s)?.textContent ?? '', sel);
  const exists = (sel: string) =>
    tab.evaluate((s) => !!document.querySelector('[data-skipper]')?.shadowRoot?.querySelector(s), sel);
  const centre = (sel: string) =>
    tab.evaluate((s) => {
      const r = document.querySelector('[data-skipper]')!.shadowRoot!.querySelector(s)!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
  const DONE = { shown: 0, done: true };
  const wake = async () => {
    await tab.mouse.move(300, 200);
    await tab.mouse.move(320, 210);
    await sleep(500);
  };
  const away = async () => {
    await tab.mouse.move(900, 700);
    await sleep(3400);
  };
  const withStyle = async (style: string, hints = DONE) => {
    await tab.mouse.move(900, 700);
    await setPanel({ ...BASE, style, hints });
    await park(tab, 1);
  };
  const panelNow = async () =>
    ((await worker!.evaluate(() => chrome.storage.local.get('panel'))) as {
      panel?: { selected?: number; style?: string; hints?: { shown: number; done: boolean } };
    }).panel ?? {};

  // The picker on the default style
  await withStyle('pills');
  await wake();
  const r = await centre('.side.r .handle');
  await tab.mouse.move(r.x, r.y);
  await sleep(500);
  check('hovering a pill shows the amounts either side', (await hasCls('.side.r', 'pick')) && (await text('.side.r .nb.up')) === '5s' && (await text('.side.r .nb.down')) === '1s',
    `up=${await text('.side.r .nb.up')} down=${await text('.side.r .nb.down')}`);
  const up = await centre('.side.r .nb.up');
  await tab.mouse.move(up.x, up.y);
  await tab.mouse.click(up.x, up.y);
  await sleep(400);
  check('clicking one of them selects it', (await panelNow()).selected === 5, `selected=${(await panelNow()).selected}`);
  await setPanel(BASE);

  // The one-time tip
  await withStyle('pills', { shown: 0, done: false });
  await wake();
  check('the tip shows the first time, in the style\'s own words', (await hasCls('.tip', 'on')) && (await text('.tip')).includes('Hover a pill'), await text('.tip'));
  const tipBox = await tab.evaluate(() => {
    const r = document.querySelector('[data-skipper]')?.shadowRoot?.querySelector('.tip')?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
  });
  check('the tip is a readable box, not a column of single words', !!tipBox && tipBox.w >= 200 && tipBox.h <= 90, JSON.stringify(tipBox));
  check('and is counted', (await panelNow()).hints?.shown === 1, JSON.stringify((await panelNow()).hints));
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  check('using the feature takes it away for good', !(await hasCls('.tip', 'on')) && (await panelNow()).hints?.done === true, JSON.stringify((await panelNow()).hints));
  await withStyle('pills', { shown: 3, done: false });
  await wake();
  check('it is not shown a fourth time', !(await hasCls('.tip', 'on')));

  // Side dock
  await withStyle('dock');
  await wake();
  check('dock: a single tab shows, not the pills', (await hasCls('.dock', 'on')) && !(await exists('.side')) && !(await hasCls('.dock', 'open')));
  const tabAt = await centre('.tab');
  await tab.mouse.move(tabAt.x, tabAt.y);
  await sleep(600);
  check('dock: hovering the tab opens the controls', await hasCls('.dock', 'open'));
  const fwdAt = await centre('.fwd');
  await tab.mouse.move(fwdAt.x, fwdAt.y);
  await tab.mouse.click(fwdAt.x, fwdAt.y);
  await sleep(500);
  check('dock: its forward button jumps and floats the number', Math.abs((await at(tab)) - 3) < 0.5 && (await text('.float')) === '+2s', `${(await at(tab)).toFixed(1)}s ${await text('.float')}`);
  const chipAt = await tab.evaluate(() => {
    const c = [...document.querySelector('[data-skipper]')!.shadowRoot!.querySelectorAll('.chip')].find((x) => x.textContent === '5s')!;
    const b = c.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await tab.mouse.move(chipAt.x, chipAt.y);
  await tab.mouse.click(chipAt.x, chipAt.y);
  await sleep(400);
  check('dock: a chip selects that amount', (await panelNow()).selected === 5, `selected=${(await panelNow()).selected}`);
  await away();
  check('dock: it slides away and closes by itself', !(await hasCls('.dock', 'on')) && !(await hasCls('.dock', 'open')));
  await setPanel(BASE);

  // Gesture
  await withStyle('gesture');
  await wake();
  check('gesture: nothing is drawn on the video', !(await hasCls('.guide', 'on')) && !(await hasCls('.hud', 'on')) && !(await exists('.side')));
  await tab.keyboard.down('Alt');
  await sleep(400);
  check('gesture: holding Alt shows what scrolling does', (await hasCls('.guide', 'on')) && (await text('.guide .gf')) === '+2s', await text('.guide .gf'));
  await tab.mouse.wheel({ deltaY: -100 });
  await sleep(600);
  check('gesture: Alt + scroll up skips forward and ticks the number', Math.abs((await at(tab)) - 3) < 0.5 && (await text('.hud .num')) === '+2s' && (await hasCls('.hud', 'on')),
    `${(await at(tab)).toFixed(1)}s ${await text('.hud .num')}`);
  await tab.mouse.wheel({ deltaY: 100 });
  await sleep(600);
  check('gesture: scrolling down skips back', Math.abs((await at(tab)) - 1) < 0.5, `${(await at(tab)).toFixed(1)}s`);
  await tab.keyboard.down('Shift');
  await tab.mouse.wheel({ deltaY: -100 });
  await sleep(500);
  await tab.keyboard.up('Shift');
  check('gesture: Shift + scroll changes the amount', (await panelNow()).selected === 5, `selected=${(await panelNow()).selected}`);
  await tab.keyboard.up('Alt');
  await sleep(400);
  check('gesture: the guide goes when Alt is released', !(await hasCls('.guide', 'on')));
  await setPanel(BASE);

  // Timeline
  await withStyle('timeline');
  await wake();
  check('timeline: nothing is drawn until a jump', !(await hasCls('.tl', 'on')) && !(await exists('.side')));
  await press(tab, ['Alt', 'Shift'], 'ArrowRight');
  const duration = await tab.evaluate(() => document.querySelector('video')!.duration);
  const dotLeft = parseFloat(await tab.evaluate(() => (document.querySelector('[data-skipper]')!.shadowRoot!.querySelector('.dot') as HTMLElement).style.left));
  check('timeline: a jump shows the bar with both times and the total',
    (await hasCls('.tl', 'on')) && (await text('.from')) === '0:01' && (await text('.to')) === '0:03' && (await text('.chip')) === '+2s',
    `${await text('.from')} → ${await text('.to')} ${await text('.chip')}`);
  check('timeline: the marker is where the video landed', Math.abs(dotLeft - (3 / duration) * 100) < 3, `${dotLeft.toFixed(0)}% of ${duration.toFixed(1)}s`);
  await sleep(2300);
  check('timeline: the bar leaves by itself', !(await hasCls('.tl', 'on')));
  await tab.keyboard.down('Alt');
  await sleep(400);
  check('timeline: holding Alt shows the bar with a hint', (await hasCls('.tl', 'on')) && (await text('.chip')).includes('2s'), await text('.chip'));
  await park(tab, 1);
  await tab.mouse.wheel({ deltaY: -100 });
  await sleep(600);
  await tab.keyboard.up('Alt');
  check('timeline: Alt + scroll skips too', Math.abs((await at(tab)) - 3) < 0.6, `${(await at(tab)).toFixed(1)}s`);

  // Choosing the style in the popup
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${new URL(workerTarget.url()).hostname}/popup.html`);
  await sleep(1500);
  const tabButton = (name: RegExp) => popup.evaluate((src) => {
    const b = [...document.querySelectorAll('nav.tabs button')].find((x) => new RegExp(src).test(x.textContent ?? '')) as HTMLElement | undefined;
    b?.click();
    return !!b;
  }, name.source);
  await tabButton(/Settings/);
  await popup.evaluate(() => [...document.querySelectorAll('button.style-card')].find((b) => /Gesture/.test(b.textContent ?? ''))!.click());
  await sleep(600);
  check('the popup lists four styles and saves the one picked, restarting its tip',
    (await popup.$$('button.style-card')).length === 4 && (await panelNow()).style === 'gesture' && (await panelNow()).hints?.done === false,
    JSON.stringify(await panelNow()));

  // An install that saved the old amounts can get the defaults back
  await setPanel({ ...BASE, presets: [10, 30, 60, 300], selected: 30 });
  await popup.reload();
  await sleep(1200);
  const chipTexts = () => popup.evaluate(() => [...document.querySelectorAll('.scroll .chips button.chip')].map((b) => b.textContent));
  await tabButton(/Skip/);
  await sleep(300);
  await popup.evaluate(() => ([...document.querySelectorAll('.scroll .chips button.chip')].find((b) => b.textContent === 'Edit') as HTMLElement).click());
  await sleep(200);
  const clickButton = (re: string) => popup.evaluate((src) => {
    const b = [...document.querySelectorAll('.scroll button')].find((x) => new RegExp(src).test(x.textContent ?? '')) as HTMLElement | undefined;
    b?.click();
    return !!b;
  }, re);
  await clickButton('Restore default amounts');
  await sleep(300);
  const asked = await popup.evaluate(() => !!document.querySelector('[role="alertdialog"]'));
  await sleep(200);
  check('"Restore default amounts" asks first, and nothing changes yet', asked && !(await chipTexts()).includes('1m30s'), JSON.stringify(await chipTexts()));
  await clickButton('^Cancel$');
  await sleep(300);
  check('Cancel keeps the amounts', !(await popup.evaluate(() => !!document.querySelector('[role="alertdialog"]'))) && !(await chipTexts()).includes('1m30s'), JSON.stringify(await chipTexts()));
  await clickButton('Restore default amounts');
  await sleep(200);
  await clickButton('^Restore$');
  await sleep(500);
  check('confirming brings back 10s, 15s, 1m, 1m30s, 5m, 10m',
    JSON.stringify(await chipTexts()) === JSON.stringify(['10s', '15s', '1m', '1m30s', '5m', '10m', 'Edit']), JSON.stringify(await chipTexts()));
  // A mixed amount typed in the box: 1h30m30s
  await popup.evaluate(() => { const i = document.querySelector('.scroll form input') as HTMLInputElement; i.focus(); });
  await popup.keyboard.type('1h30m30s');
  await sleep(300);
  const useLabel = await popup.evaluate(() => (document.querySelector('.scroll form button[type="submit"]') as HTMLButtonElement).textContent);
  check('typing 1h30m30s is understood and offered as 1h30m30s', useLabel === 'Use 1h30m30s', `${useLabel}`);
  await popup.keyboard.press('Enter');
  await sleep(500);
  check('and becomes a chip, selected', (await chipTexts()).includes('1h30m30s') && (await panelNow()).selected === 5430, JSON.stringify(await chipTexts()));
  await tabButton(/Settings/);
  await sleep(300);

  const scrolling = await popup.evaluate(() => {
    const s = document.querySelector('.scroll') as HTMLElement;
    s.scrollTop = 99999;
    const f = document.querySelector('footer')!.getBoundingClientRect();
    return { scrollable: s.scrollHeight > s.clientHeight, atEnd: s.scrollTop > 0, footerShown: f.bottom <= innerHeight, pageFits: document.documentElement.scrollHeight <= innerHeight };
  });
  check('the popup scrolls inside its own area and the footer stays put', scrolling.scrollable && scrolling.atEnd && scrolling.footerShown && scrolling.pageFits, JSON.stringify(scrolling));

  // Language: the popup and the panel on the video follow the picker
  const langBtn = (l: string) => popup.evaluate((x) => {
    const b = [...document.querySelectorAll('.segmented button')].find((y) => y.textContent === x) as HTMLElement | undefined;
    b?.click();
    return !!b;
  }, l);
  const tabsText = () => popup.evaluate(() => document.querySelector('nav.tabs')?.textContent ?? '');
  check('the popup starts in English whatever the browser says', (await tabsText()).includes('Settings'), await tabsText());
  await langBtn('IT');
  await sleep(400);
  const savedLang = async () => ((await worker!.evaluate(() => chrome.storage.local.get('language'))) as { language?: string }).language;
  check('picking IT switches the popup to Italian and saves it', (await tabsText()).includes('Impostazioni') && (await savedLang()) === 'it', `${await tabsText()} / ${await savedLang()}`);
  await popup.reload();
  await sleep(1200);
  const selectedTab = await popup.evaluate(() => document.querySelector('nav.tabs button[aria-selected="true"]')?.textContent ?? '');
  check('the language and the last tab are remembered', selectedTab.includes('Impostazioni') && (await tabsText()).includes('Telefono'), selectedTab);
  await setPanel({ ...BASE, style: 'pills', hints: { shown: 0, done: false } });
  await tab.bringToFront();
  await tab.reload();
  await tab.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await sleep(1000);
  await wake();
  check('the tip on the video speaks Italian too', (await text('.tip')).includes('Passa su una pillola'), await text('.tip'));
  await popup.bringToFront();
  await langBtn('EN');
  await sleep(400);
  check('and EN brings English back', (await tabsText()).includes('Settings') && (await savedLang()) === 'en');
  await popup.close();
  await setPanel(BASE);
  await tab.bringToFront();

  await pc.transport.close();
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

  // 4 -- no relay at all: what setup saves with the relay field left empty. The default
  // public MQTT broker alone has to carry a phone's commands.
  console.log('\n[no relay: default MQTT broker only]');
  await w2!.evaluate((settings) => chrome.storage.local.set({ settings }), { pairCode, relayUrl: '', mqttUrl: DEFAULT_MQTT_URL, disabled: [] });
  await sleep(4000);
  const mqttPhone = new MqttTransport({ url: DEFAULT_MQTT_URL, room, role: 'controller' });
  const mc = new Controller(mqttPhone);
  let mqttUp = true;
  try {
    await mc.connect();
  } catch (e) {
    mqttUp = false;
    console.log(`  skip  the public broker is not reachable from here (${(e as Error).message})`);
  }
  if (mqttUp) {
    await mqttPhone.send(sign({ type: 'ping', nonce: 'n' }));
    const mst = await mc.status();
    check('status over the default MQTT broker alone', typeof mst?.foregroundPackage === 'string', `${mst?.foregroundPackage}`);
    const mseek = await mc.cmd({ op: 'playback.seekTo', positionMs: 3000 });
    await sleep(400);
    const mt = Number(await tab.evaluate(() => document.querySelector('video')!.currentTime));
    check('seekTo over the default MQTT broker alone', !!mseek?.ok && Math.abs(mt - 3) < 0.8, `${mt.toFixed(1)}s ${mseek?.detail}`);
    await mqttPhone.close();
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
