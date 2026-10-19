import { clock, jumpLabel } from '@relay/protocol';
import { fraction } from '../panel';
import { tr } from '../shared';
import { GLASS, restart, signed, type Rect, type StyleDef, type StyleView } from './types';

/**
 * Timeline: nothing on the video either. After a jump (shortcut or Alt +
 * scroll) a bar glides in along the bottom: a marker travels from where you
 * were to where you landed, with both times and the total. Holding Alt shows
 * the bar at the current position with a hint, so it explains the gesture.
 */

const HOLD_MS = 1700;
const BOTTOM_GAP = 150;

const html = `
  <div class="tl" aria-hidden="true">
    <div class="times"><span class="from"></span><span class="chip"></span><span class="to"></span></div>
    <div class="track"><div class="fill"></div><div class="ghost"></div><div class="dot"></div></div>
  </div>`;

const css = `
.tl { position: absolute; display: flex; flex-direction: column; gap: 11px; padding: 13px 18px 16px; border-radius: 18px; ${GLASS}
  opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%, 14px) scale(.98);
  transition: opacity .2s ease-in, transform .26s ease-in, visibility 0s linear .26s; }
.tl.on { opacity: 1; visibility: visible; transform: translate(-50%, 0);
  transition: opacity .16s ease-out, transform .4s cubic-bezier(.2, 1.1, .3, 1), visibility 0s; }
.times { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums; }
.from { opacity: .6; min-width: 3.6ch; }
.to { min-width: 3.6ch; text-align: right; }
.chip { padding: 3px 13px; border-radius: 999px; background: rgba(232, 176, 75, .22); color: #e8b04b; font-weight: 700; white-space: nowrap; }
.chip.pop { animation: pop .3s cubic-bezier(.3, 1.5, .5, 1); }
@keyframes pop { 0% { transform: scale(.82); } 100% { transform: none; } }
.track { position: relative; height: 6px; border-radius: 999px; background: rgba(255, 255, 255, .2); }
.fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: inherit;
  background: linear-gradient(90deg, rgba(232, 176, 75, .5), #e8b04b); }
.ghost { position: absolute; left: 0; top: -3px; width: 2px; height: 12px; margin-left: -1px; border-radius: 1px; background: rgba(255, 255, 255, .75); }
.dot { position: absolute; left: 0; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 4px rgba(232, 176, 75, .35), 0 2px 8px rgba(0, 0, 0, .4); }
.glide .fill { transition: width .55s cubic-bezier(.2, .9, .2, 1); }
.glide .dot { transition: left .55s cubic-bezier(.2, .9, .2, 1); }
.nopos .track { opacity: .25; }
.nopos .ghost, .nopos .dot { display: none; }
@media (prefers-reduced-motion: reduce) {
  .tl, .tl.on { transition: opacity .15s linear, visibility 0s; transform: translate(-50%, 0); }
  .glide .fill, .glide .dot { transition: none; }
  .chip.pop { animation: none; }
}`;

export const timeline: StyleDef = {
  wakes: false,
  altWheel: true,
  css,
  html,
  create(ctx): StyleView {
    const root = ctx.root;
    const tl = root.querySelector<HTMLElement>('.tl')!;
    const fromEl = tl.querySelector<HTMLElement>('.from')!;
    const toEl = tl.querySelector<HTMLElement>('.to')!;
    const chip = tl.querySelector<HTMLElement>('.chip')!;
    const fill = tl.querySelector<HTMLElement>('.fill')!;
    const ghost = tl.querySelector<HTMLElement>('.ghost')!;
    const dot = tl.querySelector<HTMLElement>('.dot')!;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let altHeld = false;
    let runFrom: number | null = null;

    const at = (f: number | null, glide: boolean) => {
      tl.classList.toggle('nopos', f === null);
      if (f === null) return;
      tl.classList.toggle('glide', glide);
      fill.style.width = `${f * 100}%`;
      dot.style.left = `${f * 100}%`;
    };
    const time = (ms: number | null) => (ms === null ? '' : clock(ms / 1000));

    return {
      place(r: Rect) {
        const width = Math.min(520, (r.right - r.left) * 0.72);
        tl.style.width = `${width}px`;
        tl.style.left = `${(r.left + r.right) / 2}px`;
        tl.style.top = `${Math.max(r.top + 8, r.bottom - BOTTOM_GAP)}px`;
      },
      show() {},
      hide() {
        altHeld = false;
        clearTimeout(hold);
        tl.classList.remove('on');
      },
      render() {},
      guide(on, pos) {
        altHeld = on;
        if (!on) {
          // Let a jump that is still showing finish on its own.
          if (!hold) tl.classList.remove('on');
          return;
        }
        const f = fraction(pos.ms, pos.duration);
        runFrom = null;
        at(f, false);
        ghost.style.left = `${(f ?? 0) * 100}%`;
        ghost.style.opacity = '0';
        fromEl.textContent = time(pos.ms);
        toEl.textContent = '';
        chip.textContent = tr('tlGuide', { amount: jumpLabel(ctx.settings().selected) });
        tl.classList.add('on');
      },
      jumped(e) {
        const f = fraction(e.to, e.duration);
        if (e.fresh || runFrom === null) {
          // A new run starts from where the video was, with no glide.
          runFrom = e.from;
          const f0 = fraction(e.from, e.duration);
          at(f0, false);
          ghost.style.left = `${(f0 ?? 0) * 100}%`;
          ghost.style.opacity = f0 === null ? '0' : '1';
          void tl.offsetWidth;
        }
        at(f, true);
        fromEl.textContent = time(runFrom);
        toEl.textContent = time(e.to);
        chip.textContent = signed(e.dir, jumpLabel(e.total));
        restart(chip, 'pop');
        tl.classList.add('on');
        clearTimeout(hold);
        hold = setTimeout(() => {
          hold = undefined;
          if (!altHeld) tl.classList.remove('on');
        }, HOLD_MS);
      },
    };
  },
};
