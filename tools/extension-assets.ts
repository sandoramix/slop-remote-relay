/**
 * Screenshots and store images for the browser extension, from the real build.
 *
 *   npm run build -w @relay/browser-extension
 *   npx tsx tools/extension-assets.ts
 *
 * Drives the extension in Chrome for Testing (no phone needed beyond a simulated
 * one for the "connected" shot) and writes:
 *   pages/img/extension-*.png     the popup, each tab and state, for the guide
 *   pages/img/style-*.jpg         each skip style on a video, for the guide
 *   docs/store-assets/*.png       the Chrome Web Store screenshots and promo images
 *
 * The sample video is Big Buck Bunny (c) Blender Foundation, CC BY 3.0, streamed
 * from the Internet Archive; the images that show it carry that credit. It is the
 * full film so the timeline style has a real duration to travel along.
 */
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { canonicalize } from '../packages/protocol/src/codec';
import { PROTOCOL_VERSION } from '../packages/protocol/src/messages';
import { RelayWsTransport } from '../packages/transports/src/index';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SITE = path.join(root, 'pages/img');
const STORE = path.join(root, 'docs/store-assets');
const RELAY_PORT = 18291;
const PAGE_PORT = 18292;
const VIDEO = 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';
/** A frame worth showing: the bunny, in the grass. */
const FRAME_AT = 78;
const CREDIT = 'Big Buck Bunny © Blender Foundation, CC BY 3.0';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (buf: Buffer) => `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
/** Video frames are photographs: JPEG, a fifth of the size. */
const JPEG = { type: 'jpeg', quality: 86 } as const;
const logo = `data:image/svg+xml;base64,${readFileSync(path.join(root, 'docs/brand/skipper.svg')).toString('base64')}`;

mkdirSync(SITE, { recursive: true });
mkdirSync(STORE, { recursive: true });
const save = (dir: string, name: string, buf: Buffer) => {
  writeFileSync(path.join(dir, name), buf);
  console.log(`${path.relative(root, path.join(dir, name))}`);
  return buf;
};

async function main() {
  // ------------------------------------------------------------- the world
  const relay = spawn(process.execPath, ['--import', 'tsx', 'services/relay/src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: 'ignore',
  });
  const page = createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(`<!doctype html><meta charset="utf-8"><title>Big Buck Bunny</title><body style="margin:0;background:#000">
      <video controls muted preload="auto" style="width:960px;height:540px;display:block" src="${VIDEO}"></video>`);
  }).listen(PAGE_PORT);
  await sleep(1500);

  // The extension as built, at the latest release's version so no update banner shows.
  const ext = mkdtempSync(path.join(tmpdir(), 'relay-ext-'));
  cpSync(path.join(root, 'apps/browser-extension/dist'), ext, { recursive: true });
  const manifestPath = path.join(ext, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.5.0';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const browser = await puppeteer.launch({ headless: true, enableExtensions: true, args: ['--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP watch.example 127.0.0.1'] });
  await browser.installExtension(ext);
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker');
  const id = new URL(sw.url()).host;
  const worker = (await sw.worker())!;
  const store = (patch: Record<string, unknown>) => worker.evaluate((p) => chrome.storage.local.set(p), patch as never);
  await store({ panelIntro: true, language: 'en', update: { version: '0.0.1', pageUrl: '', zipUrl: null, summary: [], important: false, checkedAt: Date.now() } });

  // ---------------------------------------------------------- the popup
  const popup = await browser.newPage();
  await popup.setViewport({ width: 380, height: 600, deviceScaleFactor: 2 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const popupShot = async (tab: 'skip' | 'phone' | 'settings', opts: { open?: string[]; scrollTop?: number; wait?: number } = {}) => {
    await popup.evaluate((t) => chrome.storage.local.set({ popupTab: t }), tab);
    await popup.bringToFront();
    await popup.reload({ waitUntil: 'networkidle0' });
    await sleep(opts.wait ?? 1500);
    for (const title of opts.open ?? []) {
      await popup.evaluate((t) => ([...document.querySelectorAll('summary')].find((s) => s.textContent?.trim() === t) as HTMLElement | undefined)?.click(), title);
    }
    await popup.evaluate((y) => { (document.querySelector('.scroll') as HTMLElement).scrollTop = y; }, opts.scrollTop ?? 0);
    await sleep(400);
    return Buffer.from((await (await popup.$('body'))!.screenshot()) as Uint8Array);
  };

  // The video tab, so "Now controlling" has something to name.
  const vid = await browser.newPage();
  await vid.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  // A neutral host name, so no screenshot shows 127.0.0.1.
  await vid.goto(`http://watch.example:${PAGE_PORT}/`);
  await vid.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 90_000 });
  const park = async (t: number) => {
    await vid.bringToFront(); // a background tab does not decode a seek
    await vid.evaluate((x) => { const v = document.querySelector('video')!; v.pause(); v.currentTime = x; }, t);
    await vid.waitForFunction(() => { const v = document.querySelector('video')!; return !v.seeking && v.readyState >= 2; }, { timeout: 180_000 });
    await sleep(600);
  };
  await park(FRAME_AT);

  // 1. not set up yet
  const setup = save(SITE, 'extension-setup.png', await popupShot('phone'));

  // 2. paired, waiting for a phone: the QR code
  const pairCode = 'k7vd-3mqx-9hpa-wr2e';
  await store({ settings: { pairCode, relayUrl: '', mqttUrl: 'wss://broker.hivemq.com:8884/mqtt', disabled: [] } });
  await sleep(2500);
  const qr = save(SITE, 'extension-pair.png', await popupShot('phone', { wait: 2000 }));
  // Relay empty, broker at its default: what "works as is" looks like.
  const broker = save(SITE, 'extension-broker.png', await popupShot('phone', { open: ['Relay and broker'], scrollTop: 9999, wait: 2000 }));

  // 3. the skip tab and the settings tab
  const skip = save(SITE, 'extension-skip.png', await popupShot('skip', { wait: 2500 }));
  const styles = save(SITE, 'extension-styles.png', await popupShot('settings'));
  save(SITE, 'extension-shortcuts.png', await popupShot('settings', { open: ['Shortcuts'], scrollTop: 520 }));

  // 4. a phone connected, after a command
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const secret = sha(`secret:${pairCode}`);
  const room = sha(`room:${pairCode}`).slice(0, 24);
  const sign = (body: Record<string, unknown>) => {
    const env: Record<string, unknown> = { v: PROTOCOL_VERSION, id: randomUUID(), ts: Date.now(), ...body };
    env.sig = createHmac('sha256', secret).update(canonicalize(env as never)).digest('hex');
    return JSON.stringify(env);
  };
  await store({ settings: { pairCode, relayUrl: `ws://127.0.0.1:${RELAY_PORT}`, mqttUrl: '', disabled: ['mqtt'] } });
  await sleep(3000);
  const phone = new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' });
  await phone.connect({ onMessage: () => undefined, onStateChange: () => undefined });
  await phone.send(sign({ type: 'ping', nonce: 'n' }));
  await phone.send(sign({ type: 'cmd', cmd: { op: 'playback.seek', deltaMs: 30000 } }));
  await sleep(1500);
  await park(FRAME_AT);
  const connected = save(SITE, 'extension-connected.png', await popupShot('phone', { wait: 2500 }));
  await phone.close();
  await store({ settings: { pairCode: '', relayUrl: '', mqttUrl: 'wss://broker.hivemq.com:8884/mqtt', disabled: [] } });

  // ----------------------------------------------- each style on the video
  await vid.bringToFront();
  const setPanel = async (panel: Record<string, unknown>) => { await store({ panel }); await sleep(500); };
  const centre = (sel: string) =>
    vid.evaluate((s) => {
      const r = document.querySelector('[data-skipper]')!.shadowRoot!.querySelector(s)!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
  const wake = async () => { await vid.mouse.move(430, 250); await vid.mouse.move(470, 262); await sleep(700); };
  const frame = async (name: string) => { await sleep(500); return save(SITE, name, Buffer.from((await vid.screenshot(JPEG)) as Uint8Array)); };
  const DONE = { shown: 0, done: true };

  await setPanel({ style: 'pills', hints: DONE });
  await park(FRAME_AT);
  await wake();
  const r = await centre('.side.r .handle');
  await vid.mouse.move(r.x, r.y);
  await sleep(600);
  const pills = await frame('style-pills.jpg');

  await vid.mouse.move(40, 500);
  await setPanel({ style: 'dock', hints: DONE });
  await park(FRAME_AT);
  await wake();
  const t = await centre('.tab');
  await vid.mouse.move(t.x, t.y);
  await sleep(700);
  const dock = await frame('style-dock.jpg');

  await vid.mouse.move(40, 500);
  await setPanel({ style: 'gesture', hints: DONE });
  await park(FRAME_AT);
  await wake();
  await vid.keyboard.down('Alt');
  await sleep(500);
  await vid.mouse.wheel({ deltaY: -100 });
  await sleep(250);
  await vid.mouse.wheel({ deltaY: -100 });
  await sleep(250);
  await vid.mouse.wheel({ deltaY: -100 });
  // Catch the number while it is up: it fades a second after the last notch.
  await vid.waitForFunction(() => !!document.querySelector('[data-skipper]')?.shadowRoot?.querySelector('.hud.on'), { timeout: 20_000 });
  // The capture itself is slow with a video decoding, so keep scrolling while it is taken.
  const keepGoing = setInterval(() => void vid.mouse.wheel({ deltaY: -100 }).catch(() => undefined), 300);
  await sleep(500);
  const gesture = save(SITE, 'style-gesture.jpg', Buffer.from((await vid.screenshot(JPEG)) as Uint8Array));
  clearInterval(keepGoing);
  await vid.keyboard.up('Alt');

  await vid.mouse.move(40, 500);
  await setPanel({ style: 'timeline', hints: DONE, selected: 60 });
  await park(FRAME_AT);
  await wake();
  await vid.keyboard.down('Alt');
  await vid.keyboard.down('Shift');
  await vid.keyboard.press('ArrowRight');
  await vid.keyboard.up('Shift');
  await vid.keyboard.up('Alt');
  await sleep(300);
  const timeline = await frame('style-timeline.jpg');
  await setPanel({ style: 'pills', hints: DONE });

  // The first-use tip, as a person meets it.
  await vid.mouse.move(40, 500);
  await setPanel({ style: 'pills', hints: { shown: 0, done: false } });
  await vid.reload();
  await vid.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, { timeout: 90_000 });
  await park(FRAME_AT);
  await sleep(800);
  await wake();
  await sleep(500);
  save(SITE, 'style-tip.jpg', Buffer.from((await vid.screenshot(JPEG)) as Uint8Array));

  // --------------------------------------------------- the store images
  const comp = await browser.newPage();
  const render = async (dir: string, name: string, w: number, h: number, body: string) => {
    await comp.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await comp.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box} body{margin:0;width:${w}px;height:${h}px;overflow:hidden;position:relative;color:#ede9e3;
        font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
        background:radial-gradient(900px 500px at 85% 110%,rgba(232,176,75,.14),transparent 60%),#14181e}
      .brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:26px}
      .brand img{width:46px;height:46px}
      h1{margin:0;font-size:54px;line-height:1.05;letter-spacing:-.02em;font-weight:800}
      h1 em{font-style:normal;color:#e8b04b}
      p{margin:0;color:#8b95a3;font-size:22px;line-height:1.45}
      .abs{position:absolute} .shadow{box-shadow:0 24px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}
      .round{border-radius:16px;display:block}
      .credit{position:absolute;font-size:12px;color:#5d6673;letter-spacing:.02em}
      .tag{font-size:21px;font-weight:700} .tagsub{font-size:15px;color:#8b95a3;margin-top:2px}
    </style>${body}`);
    await sleep(300);
    save(dir, name, Buffer.from((await comp.screenshot()) as Uint8Array));
  };
  const img = (buf: Buffer, css: string, cls = 'round shadow') => `<img class="abs ${cls}" style="${css}" src="${b64(buf)}">`;
  const brand = (css: string) => `<div class="abs brand" style="${css}"><img src="${logo}">Skipper</div>`;
  const credit = (css: string) => `<div class="credit" style="${css}">${CREDIT}</div>`;

  // 1280x800: skip right on the video
  await render(STORE, 'screenshot-4-skip.png', 1280, 800, `
    ${brand('left:60px;top:46px')}
    <h1 class="abs" style="left:60px;top:116px;width:760px">Skip <em>right on the video.</em></h1>
    <p class="abs" style="left:60px;top:196px;width:700px;font-size:21px">No phone needed. Hover any video, or press Alt + Shift + →.</p>
    ${img(pills, 'left:60px;top:270px;width:700px;height:394px')}
    ${img(skip, 'left:820px;top:130px;width:380px')}
    ${credit('left:60px;top:680px')}`);

  // 1280x800: four ways to skip
  const cell = (buf: Buffer, x: number, y: number, name: string, sub: string) => `
    ${img(buf, `left:${x}px;top:${y}px;width:540px;height:304px`)}
    <div class="abs" style="left:${x + 14}px;top:${y + 14}px;padding:8px 14px;border-radius:12px;background:rgba(18,22,28,.82);border:1px solid rgba(255,255,255,.14)">
      <div class="tag">${name}</div><div class="tagsub">${sub}</div></div>`;
  await render(STORE, 'screenshot-5-styles.png', 1280, 800, `
    ${brand('left:60px;top:30px')}
    <h1 class="abs" style="left:60px;top:84px;font-size:42px;width:1100px">Four ways to skip. <em>Pick yours.</em></h1>
    ${cell(pills, 60, 156, 'Edge pills', 'Hover one to pick the amount')}
    ${cell(dock, 680, 156, 'Side dock', 'One tab that opens into buttons')}
    ${cell(gesture, 60, 470, 'Gesture', 'Hold Alt and scroll over the video')}
    ${cell(timeline, 680, 470, 'Timeline', 'A bar shows where you landed')}
    ${credit('left:60px;top:780px')}`);

  // 1280x800: set up
  await render(STORE, 'screenshot-2-setup.png', 1280, 800, `
    ${brand('left:80px;top:150px')}
    <h1 class="abs" style="left:80px;top:226px;width:560px;font-size:56px">Set up <em>in a minute.</em></h1>
    <div class="abs" style="left:80px;top:370px;width:540px;font-size:22px;color:#8b95a3;line-height:1.5">
      <p>1. Leave the relay empty. It works as is, over the public MQTT broker.</p><p style="margin-top:14px">2. Scan the QR code with the Skipper app on your phone.</p><p style="margin-top:14px">3. Done. Commands go to the tab playing a video.</p></div>
    ${img(qr, 'left:780px;top:60px;width:380px')}`);

  // 1400x560 marquee and 440x280 small promo
  await render(STORE, 'promo-marquee-1400x560.png', 1400, 560, `
    ${brand('left:110px;top:100px')}
    <h1 class="abs" style="left:110px;top:176px;width:640px;font-size:62px">Skip the intro <em>from the sofa.</em></h1>
    <p class="abs" style="left:110px;top:372px;width:600px">Your phone becomes the remote for the video in your browser. Or skip right on the video.</p>
    ${img(pills, 'left:740px;top:100px;width:580px;height:326px')}
    ${credit('left:740px;top:440px')}`);
  await render(STORE, 'promo-small-440x280.png', 440, 280, `
    ${brand('left:28px;top:30px;font-size:22px')}
    <h1 class="abs" style="left:28px;top:96px;width:260px;font-size:32px">Skip the intro <em>from the sofa.</em></h1>
    ${img(pills, 'left:232px;top:148px;width:176px;height:99px', 'round shadow')}`);

  // 1280x800: the phone as the remote (the phone's own screenshot is the app's, taken on a device)
  const remote = readFileSync(path.join(SITE, 'remote.png'));
  await render(STORE, 'screenshot-1-remote.png', 1280, 800, `
    ${brand('left:80px;top:150px')}
    <h1 class="abs" style="left:80px;top:226px;width:520px;font-size:56px">Skip the intro <em>from the sofa.</em></h1>
    <p class="abs" style="left:80px;top:420px;width:520px">Your phone becomes the remote for the video playing in this browser.</p>
    <p class="abs" style="left:80px;top:500px;width:520px;font-size:20px">Jump, pause, scrub and go fullscreen on YouTube, Netflix, Prime Video, Twitch and more.</p>
    ${img(connected, 'left:570px;top:140px;width:340px')}
    ${img(remote, 'left:940px;top:100px;width:290px;border-radius:26px')}`);

  // 1280x800: privacy
  await render(STORE, 'screenshot-3-private.png', 1280, 800, `
    ${brand('left:80px;top:190px')}
    <h1 class="abs" style="left:80px;top:266px;width:560px;font-size:56px">Yours, <em>not ours.</em></h1>
    <p class="abs" style="left:80px;top:370px;width:560px">No accounts, no analytics, no ads. Commands go through a relay server you run, or an MQTT broker.</p>
    <p class="abs" style="left:80px;top:488px;width:560px">Every command is signed with your pairing code: nobody else can send one.</p>
    ${img(broker, 'left:780px;top:100px;width:380px')}`);

  void [setup, styles, dock, gesture, timeline];
  await browser.close();
  relay.kill();
  page.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
