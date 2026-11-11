/**
 * Graphic assets for the two Google Play listings that are not screenshots of
 * the app: the 512×512 icon and the 1024×500 feature graphic of each app.
 *
 *   npx tsx tools/play-assets.ts
 *
 * Writes docs/store-assets/play/<receiver|controller>/icon-512.png and
 * feature-graphic-1024x500.png. The receiver's icon is drawn from the same
 * paths as its launcher icon (res/drawable/ic_launcher_foreground.xml, colours
 * from res/values/colors.xml); the controller's is the existing icon.png. The
 * phone screenshots are real captures from the emulator, taken by hand
 * with `adb screencap`, never drawn here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(root, 'docs/store-assets/play');

/** The receiver mark, copied from its launcher vector: a dot, a stem and two pairs of arcs. */
const receiverMark = (stroke: string) => `
  <g transform="translate(22.8 22.8) scale(2.6)" fill="${stroke}" stroke="none">
    <circle cx="12" cy="9.5" r="2"/>
    <rect x="11" y="10.5" width="2" height="9.5"/>
  </g>
  <g transform="translate(22.8 22.8) scale(2.6)" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round">
    <path d="M8.1,5.6A6,6 0 0,0 8.1,13.4"/>
    <path d="M15.9,5.6A6,6 0 0,1 15.9,13.4"/>
    <path d="M5.2,3.1A9.5,9.5 0 0,0 5.2,15.9"/>
    <path d="M18.8,3.1A9.5,9.5 0 0,1 18.8,15.9"/>
  </g>`;
const receiverIconSvg = (size: number, rounded = false) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
    <rect width="108" height="108" ${rounded ? 'rx="24"' : ''} fill="#0B3D62"/>${receiverMark('#FFFFFF')}
  </svg>`;

const controllerIcon = `data:image/png;base64,${readFileSync(path.join(root, 'apps/controller/assets/images/icon.png')).toString('base64')}`;
const receiverIcon = `data:image/svg+xml;base64,${Buffer.from(receiverIconSvg(220, true)).toString('base64')}`;

// Single quotes: the value lands inside a double-quoted style attribute.
const FONT = `-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

function featureGraphic(o: { icon: string; round: boolean; bg: string; accent: string; name: string; tagline: string; chips: string[] }) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1024px;height:500px;overflow:hidden;background:${o.bg};
    font-family:${FONT};color:#fff;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box">
    <img src="${o.icon}" width="220" height="220" style="border-radius:${o.round ? 48 : 0}px;box-shadow:0 12px 40px rgba(0,0,0,.45);flex:none">
    <div>
      <div style="font-size:84px;font-weight:800;letter-spacing:-2px;line-height:1">${o.name}</div>
      <div style="font-size:30px;line-height:1.3;margin-top:18px;max-width:560px;color:rgba(255,255,255,.88)">${o.tagline}</div>
      <div style="display:flex;gap:10px;margin-top:28px;flex-wrap:wrap">
        ${o.chips.map((c) => `<span style="border:2px solid ${o.accent};color:${o.accent};border-radius:999px;padding:6px 16px;font-size:20px;font-weight:600">${c}</span>`).join('')}
      </div>
    </div>`;
}

const apps = {
  controller: {
    icon: { src: controllerIcon, size: 512 },
    graphic: featureGraphic({
      icon: controllerIcon,
      round: true,
      bg: 'linear-gradient(135deg,#14181E 0%,#222a35 100%)',
      accent: '#E8B04B',
      name: 'Skipper',
      tagline: 'Skip, seek and go fullscreen on another screen, from your phone.',
      chips: ['Wi-Fi', 'Internet relay', 'MQTT', 'WebRTC', 'Bluetooth'],
    }),
  },
  receiver: {
    icon: { src: `data:image/svg+xml;base64,${Buffer.from(receiverIconSvg(512)).toString('base64')}`, size: 512 },
    graphic: featureGraphic({
      icon: receiverIcon,
      round: false,
      bg: 'linear-gradient(135deg,#0B3D62 0%,#07293F 100%)',
      accent: '#2E9BD6',
      name: 'Skipper Screen',
      tagline: 'The other half of Skipper: lets your paired phone control this screen.',
      chips: ['Fullscreen', 'Seek', 'Next episode', 'No root'],
    }),
  },
};

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [name, a] of Object.entries(apps)) {
      const dir = path.join(OUT, name);
      mkdirSync(dir, { recursive: true });

      const icon = await browser.newPage();
      await icon.setViewport({ width: a.icon.size, height: a.icon.size, deviceScaleFactor: 1 });
      await icon.setContent(`<body style="margin:0"><img src="${a.icon.src}" width="512" height="512" style="display:block">`);
      writeFileSync(path.join(dir, 'icon-512.png'), (await icon.screenshot({ type: 'png' })) as Buffer);

      const g = await browser.newPage();
      await g.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
      await g.setContent(a.graphic);
      writeFileSync(path.join(dir, 'feature-graphic-1024x500.png'), (await g.screenshot({ type: 'png' })) as Buffer);
      console.log(`docs/store-assets/play/${name}/ icon-512.png feature-graphic-1024x500.png`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
