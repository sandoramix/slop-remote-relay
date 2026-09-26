/**
 * Screenshots of the extension popup in each state, for reviewing the UI
 * without clicking through it: not set up, waiting for the phone, and a phone
 * connected with a command just run.
 *
 *   npm run build -w @relay/browser-extension
 *   npx tsx tools/extension-screenshots.ts [out-dir] [--lang=it]
 */
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { canonicalize } from '../packages/protocol/src/codec';
import { PROTOCOL_VERSION } from '../packages/protocol/src/messages';
import { RelayWsTransport } from '../packages/transports/src/index';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'out/screens');
const lang = process.argv.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'en';
const RELAY_PORT = 18191;
const PAGE_PORT = 18192;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(popup: Page, name: string) {
  await popup.bringToFront();
  await popup.reload({ waitUntil: 'networkidle0' });
  await sleep(1500);
  const body = await popup.$('body');
  await body!.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`${name}.png`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const relay = spawn(process.execPath, ['--import', 'tsx', 'services/relay/src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(RELAY_PORT) },
    stdio: 'ignore',
  });
  const page = createServer((_q, s) => {
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(`<!doctype html><meta charset="utf-8"><title>Big Buck Bunny — test</title><video controls muted loop autoplay width="640"
      src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"></video>`);
  }).listen(PAGE_PORT);
  await sleep(1500);

  const ext = mkdtempSync(path.join(tmpdir(), 'relay-ext-'));
  cpSync(path.join(root, 'apps/browser-extension/dist'), ext, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${lang}`, '--autoplay-policy=no-user-gesture-required'],
    env: { ...process.env, LANG: lang, LANGUAGE: lang },
  });
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker');
  const id = new URL(sw.url()).host;
  const worker = await sw.worker();

  const video = await browser.newPage();
  await video.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await video.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2, { timeout: 20_000 });
  await video.evaluate(() => document.querySelector("video")!.dispatchEvent(new Event("play")));

  const popup = await browser.newPage();
  await popup.setViewport({ width: 380, height: 900, deviceScaleFactor: 2 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await shot(popup, '1-setup');

  const pairCode = 'k7vd-3mqx-9hpa-wr2e';
  await worker!.evaluate(
    (settings) => chrome.storage.local.set({ settings }),
    { pairCode, relayUrl: `ws://127.0.0.1:${RELAY_PORT}`, mqttUrl: '', disabled: ['mqtt'] },
  );
  await sleep(3000);
  await shot(popup, '2-waiting');

  // A phone: the controller's own transport, pinging like TransportManager does.
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const secret = sha(`secret:${pairCode}`);
  const room = sha(`room:${pairCode}`).slice(0, 24);
  const sign = (body: Record<string, unknown>) => {
    const env: Record<string, unknown> = { v: PROTOCOL_VERSION, id: randomUUID(), ts: Date.now(), ...body };
    env.sig = createHmac('sha256', secret).update(canonicalize(env as never)).digest('hex');
    return JSON.stringify(env);
  };
  const phone = new RelayWsTransport({ url: `ws://127.0.0.1:${RELAY_PORT}`, room, role: 'controller' });
  await phone.connect({ onMessage: () => undefined, onStateChange: () => undefined });
  await phone.send(sign({ type: 'ping', nonce: 'n' }));
  await phone.send(sign({ type: 'cmd', cmd: { op: 'playback.seek', deltaMs: 30000 } }));
  await sleep(1500);
  await shot(popup, '3-connected');

  // The same popup, all sections open.
  await popup.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await sleep(300);
  await (await popup.$('body'))!.screenshot({ path: path.join(outDir, '4-expanded.png') });
  console.log('4-expanded.png');

  await phone.close();
  await browser.close();
  relay.kill();
  page.close();
  writeFileSync(path.join(outDir, 'lang.txt'), lang);
  void readFileSync;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
