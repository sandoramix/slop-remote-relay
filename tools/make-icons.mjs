// Draws the Skipper mark and renders every icon from that one drawing, so icons
// are reproducible from source instead of being opaque binaries nobody can edit.
//
//   node tools/make-icons.mjs            # writes every PNG
//   node tools/make-icons.mjs --svg      # also writes docs/brand/skipper.svg
//
// The mark: the amber key (the one backlit button on a remote) with the
// skip-forward glyph drawn as a penguin sliding forward. The play triangle is its
// body, a tuxedo split dark above and cream below, tapering to an orange beak
// that points at the skip bar, with a single slanted slit for a stern eye. An
// original drawing; the penguin is a mood, not a copy of anyone's character.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const AMBER = '#e8b04b';
const INK = '#1b2027';
const SLATE = '#14181e';
const CREAM = '#f6efe3';
const BEAK = '#e2692f';

const TRI = 'M13,20 L13,80 L56,50 Z';
const BAR = { x: 83, y: 26, w: 8, h: 48, r: 3 };
const HEAD = { x: 58, y: 50, r: 10.5 };

/** The two halves of a shape: back (dark, above the middle) and belly (cream, below). */
const split = (id, shape, back, belly) => `
  <clipPath id="${id}-t"><rect x="0" y="0" width="100" height="50"/></clipPath>
  <clipPath id="${id}-b"><rect x="0" y="50" width="100" height="50"/></clipPath>
  <g clip-path="url(#${id}-t)">${shape(back)}</g>
  <g clip-path="url(#${id}-b)">${shape(belly)}</g>`;

const tri = (fill) => `<path d="${TRI}" stroke-linejoin="round" stroke-width="8" stroke="${fill}" fill="${fill}"/>`;
const bar = (fill) => `<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.r}" fill="${fill}"/>`;
const head = (fill) => `<circle cx="${HEAD.x}" cy="${HEAD.y}" r="${HEAD.r}" fill="${fill}"/>`;
const beak = (fill) => `<path d="M67,45.5 L78,50 L67,54.5 Z" stroke-linejoin="round" stroke-width="3" stroke="${fill}" fill="${fill}"/>`;
const feet = (fill) => `<ellipse cx="8" cy="63" rx="4" ry="5.5" fill="${fill}"/><ellipse cx="8" cy="77" rx="4" ry="5.5" fill="${fill}"/>`;
const flipper = (fill) => `<ellipse cx="33" cy="64" rx="11" ry="4.2" transform="rotate(-20 33 64)" fill="${fill}"/>`;
/** The face: a cream eye and one slanted brow over it, stern. */
const eye = (fill) => `<circle cx="61" cy="50" r="2.9" fill="${fill}"/>`;
const brow = (fill) => `<path d="M54,43.2 L64.5,46.6" stroke="${fill}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`;

/** The mark in a 100×100 box. `mono`: one colour, the face and the tuxedo line cut out. */
function penguin({ mono = false } = {}) {
  if (mono) return feet('#fff') + tri('#fff') + head('#fff') + beak('#fff') + bar('#fff');
  return (
    feet(BEAK) + split('p', (c) => tri(c), INK, CREAM) + flipper(INK) + head(INK) + beak(BEAK) +
    eye(CREAM) + brow(CREAM) + split('b', (c) => bar(c), INK, CREAM)
  );
}

/** What is punched out of the monochrome silhouette: the face, and a line where the tuxedo changes colour. */
const monoMask = (id) => `
  <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
    <rect width="100" height="100" fill="#fff"/>${eye('#000')}${brow('#000')}
    <rect x="0" y="48.8" width="46" height="2.4" fill="#000"/>
    <rect x="${BAR.x - 1}" y="48.8" width="${BAR.w + 2}" height="2.4" fill="#000"/>
  </mask>`;

/** A little smaller than the key, so the glyph keeps clear of its rounded corners. */
const onKey = (inner) => `<g transform="translate(50 50) scale(.92) translate(-50 -50)">${inner}</g>`;

const KEY = `<rect x="3" y="3" width="94" height="94" rx="21" fill="${AMBER}"/>`;

/** One 100×100 drawing as a standalone SVG. */
const svg = (inner, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs>${defs}</defs>${inner}</svg>`;

/** The mark itself: key + penguin. */
export const mark = () => svg(KEY + onKey(penguin()));

const variants = {
  // Amber key on transparent (browser toolbar, splash, favicon) and on slate (launcher).
  key: mark(),
  keyOnSlate: svg(`<rect width="100" height="100" fill="${SLATE}"/>` + `<g transform="translate(50 50) scale(.9) translate(-50 -50)">${KEY + onKey(penguin())}</g>`),
  // Adaptive-icon foreground: the mark inside Android's 66% safe zone.
  foreground: svg(`<g transform="translate(50 50) scale(.56) translate(-50 -50)">${KEY + onKey(penguin())}</g>`),
  // Themed (monochrome) icon: one white shape with the eye and the tuxedo line cut out.
  monochrome: svg(`<g mask="url(#m)" transform="translate(50 50) scale(.66) translate(-50 -50)">${penguin({ mono: true })}</g>`, monoMask('m')),
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
