// Draws the Skipper mark and renders every icon from that one drawing, so icons
// are reproducible from source instead of being opaque binaries nobody can edit.
//
//   node tools/make-icons.mjs            # writes every PNG
//   node tools/make-icons.mjs --svg      # also writes docs/brand/skipper.svg
//
// The mark: the amber key (the one backlit button on a remote) with a timeline.
// A short played stretch, a gap (what you skipped), and the playhead waiting on
// the far side, with a thick arc leaping over the gap to land on it. Skip ahead,
// drawn as the thing it does instead of a play triangle.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const AMBER = '#e8b04b';
const INK = '#1b2027';
const SLATE = '#14181e';
const CREAM = '#f6efe3';
const BEAK = '#e2692f';

const LINE = 10;
const ARC = 8;

/** The drawing in a 100×100 box. `mono`: one colour (the unplayed stretch stays fainter). */
function drawing({ mono = false } = {}) {
  const ink = mono ? '#fff' : INK;
  const rest = mono ? '#fff' : CREAM;
  return `
    <path d="M14,68 L34,68" stroke="${ink}" stroke-width="${LINE}" stroke-linecap="round" fill="none"/>
    <path d="M60,68 L87,68" stroke="${rest}" stroke-width="${LINE}" stroke-linecap="round" fill="none" ${mono ? 'opacity=".55"' : ''}/>
    <circle cx="41" cy="68" r="2.5" fill="${ink}" opacity=".4"/><circle cx="47" cy="68" r="2.5" fill="${ink}" opacity=".4"/><circle cx="53" cy="68" r="2.5" fill="${ink}" opacity=".4"/>
    <path d="M22,56 C20,10 50,2 58,24" stroke="${ink}" stroke-width="${ARC}" stroke-linecap="round" fill="none"/>
    <rect x="65" y="28" width="7" height="56" rx="3.5" fill="${ink}"/>
    <circle cx="68.5" cy="28" r="11.5" fill="${ink}"/>`;
}

/** A little smaller than the key, so the drawing keeps clear of its rounded corners. */
const onKey = (inner) => `<g transform="translate(50 50) scale(.9) translate(-50 -50)">${inner}</g>`;

const KEY = `<rect x="3" y="3" width="94" height="94" rx="21" fill="${AMBER}"/>`;

/** One 100×100 drawing as a standalone SVG. */
const svg = (inner, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs>${defs}</defs>${inner}</svg>`;

/** The mark itself: key + timeline. */
export const mark = () => svg(KEY + onKey(drawing()));

const variants = {
  // Amber key on transparent (browser toolbar, splash, favicon) and on slate (launcher).
  key: mark(),
  keyOnSlate: svg(`<rect width="100" height="100" fill="${SLATE}"/>` + `<g transform="translate(50 50) scale(.9) translate(-50 -50)">${KEY + onKey(drawing())}</g>`),
  // Adaptive-icon foreground: the mark inside Android's 66% safe zone.
  foreground: svg(`<g transform="translate(50 50) scale(.56) translate(-50 -50)">${KEY + onKey(drawing())}</g>`),
  // Themed (monochrome) icon: the same drawing in white.
  monochrome: svg(`<g transform="translate(50 50) scale(.66) translate(-50 -50)">${drawing({ mono: true })}</g>`),
  background: svg(`<rect width="100" height="100" fill="${SLATE}"/>`),
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const wantSvg = process.argv.includes('--svg');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

async function render(rel, size, name) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${variants[name].replace('width="100" height="100"', `width="${size}" height="${size}"`)}</div>`,
  );
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: name !== 'keyOnSlate' && name !== 'background', clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`${rel} (${size}px)`);
}

for (const size of [16, 48, 128]) await render(`apps/browser-extension/public/icon-${size}.png`, size, 'key');
await render('apps/controller/assets/images/icon.png', 1024, 'keyOnSlate');
await render('apps/controller/assets/images/android-icon-foreground.png', 512, 'foreground');
await render('apps/controller/assets/images/android-icon-background.png', 512, 'background');
await render('apps/controller/assets/images/android-icon-monochrome.png', 512, 'monochrome');
await render('apps/controller/assets/images/splash-icon.png', 512, 'key');
await render('apps/controller/assets/images/favicon.png', 48, 'key');

if (wantSvg) {
  const file = path.join(root, 'docs/brand/skipper.svg');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, variants.key.replace('width="100" height="100"', 'width="512" height="512"') + '\n');
  console.log('docs/brand/skipper.svg');
}
await browser.close();
