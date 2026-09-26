// Renders the Relay mark to PNG with nothing but node:zlib, so icons are
// reproducible from source instead of being opaque binaries nobody can edit.
//
//   node tools/make-icons.mjs
//
// The mark: an amber key (the one backlit button on a remote) holding a dark
// "skip forward" glyph — a triangle and a bar.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AMBER = [232, 176, 75];
const INK = [27, 32, 39];
const SLATE = [20, 24, 30];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[i] = a ? Math.round(r / a) : 0;
      raw[i + 1] = a ? Math.round(g / a) : 0;
      raw[i + 2] = a ? Math.round(b / a) : 0;
      raw[i + 3] = Math.round((a / n) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed-distance helpers in unit coordinates.
const roundedSquare = (x, y, cx, cy, half, radius) => {
  const qx = Math.abs(x - cx) - half + radius;
  const qy = Math.abs(y - cy) - half + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};
const inTriangle = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** The glyph inside a key centred at (cx, cy) with the given half-size. */
function glyph(x, y, cx, cy, half) {
  const s = half / 0.4;
  const tri = inTriangle(x, y, [cx - 0.17 * s, cy - 0.17 * s], [cx - 0.17 * s, cy + 0.17 * s], [cx + 0.1 * s, cy]);
  const bar = x > cx + 0.11 * s && x < cx + 0.17 * s && Math.abs(y - cy) < 0.17 * s;
  return tri || bar;
}

/** Full icon: amber key on transparent (browser) or on slate (launcher). */
const icon = (background) => (x, y) => {
  if (roundedSquare(x, y, 0.5, 0.5, 0.46, 0.2) > 0) return background ? [...SLATE, 1] : [0, 0, 0, 0];
  return glyph(x, y, 0.5, 0.5, 0.46) ? [...INK, 1] : [...AMBER, 1];
};

/** Adaptive-icon foreground: the mark inside Android's 66% safe zone. */
const foreground = (x, y) => {
  if (roundedSquare(x, y, 0.5, 0.5, 0.26, 0.11) > 0) return [0, 0, 0, 0];
  return glyph(x, y, 0.5, 0.5, 0.26) ? [...INK, 1] : [...AMBER, 1];
};
const monochrome = (x, y) =>
  roundedSquare(x, y, 0.5, 0.5, 0.26, 0.11) <= 0 && !glyph(x, y, 0.5, 0.5, 0.26) ? [255, 255, 255, 1] : [0, 0, 0, 0];
const solid = (rgb) => () => [...rgb, 1];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = (rel, size, fn) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png(size, fn));
  console.log(`${rel} (${size}px)`);
};

for (const size of [16, 48, 128]) out(`apps/browser-extension/public/icon-${size}.png`, size, icon(false));
out('apps/controller/assets/images/icon.png', 1024, icon(true));
out('apps/controller/assets/images/android-icon-foreground.png', 512, foreground);
out('apps/controller/assets/images/android-icon-background.png', 512, solid(SLATE));
out('apps/controller/assets/images/android-icon-monochrome.png', 512, monochrome);
out('apps/controller/assets/images/splash-icon.png', 512, icon(false));
out('apps/controller/assets/images/favicon.png', 48, icon(false));
