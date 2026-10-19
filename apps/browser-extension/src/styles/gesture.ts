import { jumpLabel } from '@relay/protocol';
import { tr } from '../shared';
import { GLASS, ICON_BACK, ICON_FWD, restart, signed, type Rect, type StyleDef, type StyleView } from './types';

/**
 * Gesture: nothing on the video. Hold Alt and scroll over it: each notch skips
 * by the amount, and a large number ticks up in the middle. Pressing Alt over
 * the video shows a small guide of what scrolling will do, so the gesture
 * explains itself the first time a hand is there.
 */

const HUD_MS = 1000;

const html = `
  <div class="guide" aria-hidden="true">
    <div class="row">
      <span class="g"><span class="arr">▼</span>${ICON_BACK}<b class="gb"></b></span>
      <span class="mid"></span>
      <span class="g"><b class="gf"></b>${ICON_FWD}<span class="arr">▲</span></span>
    </div>
    <div class="sub"></div>
  </div>
  <div class="hud" aria-hidden="true"><span class="ring"></span><span class="ico"></span><span class="num"></span></div>`;

const css = `
.guide, .hud { position: absolute; ${GLASS} opacity: 0; visibility: hidden; pointer-events: none;
  transform: translate(-50%, -50%) scale(.92);
  transition: opacity .18s ease-in, transform .22s ease-in, visibility 0s linear .22s; }
.guide.on, .hud.on { opacity: 1; visibility: visible; transform: translate(-50%, -50%);
  transition: opacity .14s ease-out, transform .34s cubic-bezier(.2, 1.2, .3, 1), visibility 0s; }
.guide { display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 14px 24px; border-radius: 20px; }
.guide .row { display: flex; align-items: center; gap: 22px; }
.guide .g { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 17px; font-variant-numeric: tabular-nums; }
.guide .g svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.guide .arr { font-size: 11px; color: #e8b04b; }
.guide .mid { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.guide .sub { font-size: 12px; opacity: .6; }
.hud { display: flex; align-items: center; gap: 14px; padding: 14px 28px 14px 22px; border-radius: 999px; }
.hud .ring { position: absolute; inset: 0; border-radius: 999px; border: 2px solid #e8b04b; opacity: 0; pointer-events: none; }
.hud .ring.go { animation: ring .6s ease-out; }
@keyframes ring { 0% { opacity: .75; transform: scale(1); } 100% { opacity: 0; transform: scale(1.4, 1.8); } }
.hud .ico { display: grid; place-items: center; transition: transform .38s cubic-bezier(.3, 1.4, .5, 1); }
.hud .ico svg { width: 34px; height: 34px; fill: none; stroke: #e8b04b; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.hud .num { font-size: 40px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.hud .num.pop { animation: pop .32s cubic-bezier(.3, 1.5, .5, 1); }
@keyframes pop { 0% { transform: scale(.78); opacity: .5; } 100% { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .guide, .guide.on, .hud, .hud.on { transition: opacity .15s linear, visibility 0s; }
  .ring.go, .num.pop { animation: none; }
  .hud .ico { transition: none; }
}`;

export const gesture: StyleDef = {
  wakes: false,
  altWheel: true,
  css,
  html,
  create(ctx): StyleView {
    const root = ctx.root;
    const guide = root.querySelector<HTMLElement>('.guide')!;
    const hud = root.querySelector<HTMLElement>('.hud')!;
    const ring = hud.querySelector<HTMLElement>('.ring')!;
    const ico = hud.querySelector<HTMLElement>('.ico')!;
    const num = hud.querySelector<HTMLElement>('.num')!;
    let hudTimer: ReturnType<typeof setTimeout> | undefined;
    let altHeld = false;
    let angle = 0;

    const syncGuide = () => guide.classList.toggle('on', altHeld && !hud.classList.contains('on'));

    return {
      place(r: Rect) {
        const x = `${(r.left + r.right) / 2}px`;
        const y = `${(r.top + r.bottom) / 2}px`;
        for (const el of [guide, hud]) {
          el.style.left = x;
          el.style.top = y;
        }
      },
      show() {},
      hide() {
        altHeld = false;
        guide.classList.remove('on');
        hud.classList.remove('on');
      },
      render(p) {
        const amount = jumpLabel(p.selected);
        guide.querySelector('.gb')!.textContent = signed(-1, amount);
        guide.querySelector('.gf')!.textContent = signed(1, amount);
        guide.querySelector('.mid')!.textContent = tr('guideScroll');
        guide.querySelector('.sub')!.textContent = tr('guideShift');
      },
      guide(on) {
        altHeld = on;
        syncGuide();
      },
      jumped(e) {
        ico.replaceChildren();
        ico.innerHTML = e.dir < 0 ? ICON_BACK : ICON_FWD;
        angle += e.dir * 90;
        ico.style.transform = `rotate(${angle}deg)`;
        num.textContent = signed(e.dir, jumpLabel(e.total));
        restart(num, 'pop');
        restart(ring, 'go');
        hud.classList.add('on');
        syncGuide();
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => {
          hud.classList.remove('on');
          syncGuide();
        }, HUD_MS);
      },
    };
  },
};
