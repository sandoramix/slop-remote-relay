import { jumpLabel } from '@relay/protocol';
import { neighbours, type PanelSettings } from '../panel';
import { tr } from '../shared';
import { EDGE, GLASS, ICON_BACK, ICON_FWD, PILL_HEIGHT, restart, signed, type Rect, type StyleDef, type StyleView } from './types';

/**
 * Edge pills: back on the video's left edge, forward on the right, vertically
 * centred like a mobile player's double-tap zones. Hovering one shows the
 * amounts either side of the current one, to click or scroll through, so the
 * amount is discoverable without being told about the wheel.
 */

const WHEEL_GAP_MS = 140;
const LEAVE_MS = 260;

const side = (cls: 'l' | 'r', icon: string) => `
  <div class="side ${cls}"><div class="float"></div>
    <button class="nb up" type="button" tabindex="-1"></button>
    <button class="handle" type="button"><span class="ico">${icon}</span><span class="amt"></span></button>
    <button class="nb down" type="button" tabindex="-1"></button>
  </div>`;

const css = `
.side { position: absolute; display: flex; flex-direction: column; align-items: center; }
.side.r { transform: translateX(-100%); }
.float { position: absolute; top: 0; height: ${PILL_HEIGHT}px; display: flex; align-items: center; white-space: nowrap;
  font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; text-shadow: 0 2px 10px rgba(0, 0, 0, .55); opacity: 0; }
.l .float { left: calc(100% + 14px); }
.r .float { right: calc(100% + 14px); }
.float.go { animation: rise 900ms cubic-bezier(.2, .7, .2, 1) forwards; }
@keyframes rise { 0% { opacity: 0; transform: translateY(8px) scale(.9); } 18% { opacity: 1; transform: none; }
  70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
.handle { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 9px; height: ${PILL_HEIGHT}px;
  padding: 0 20px; border-radius: 999px; cursor: pointer; font-weight: 600; font-variant-numeric: tabular-nums; ${GLASS}
  opacity: 0; visibility: hidden; pointer-events: none; transform: translateX(var(--from)) scale(.9);
  transition: transform .24s ease-in, opacity .18s ease-in, visibility 0s linear .24s, background .15s; }
.l .handle { --from: -34px; }
.r .handle { --from: 34px; flex-direction: row-reverse; }
.handle.on { opacity: 1; visibility: visible; pointer-events: auto; transform: none;
  transition: transform .42s cubic-bezier(.2, 1.1, .3, 1), opacity .22s ease-out, visibility 0s, background .15s; }
.handle.on:hover { background: rgba(32, 38, 46, .82); }
.handle.on:active { transform: scale(.93); transition-duration: .08s; }
.handle:focus-visible, .nb:focus-visible { outline: 2px solid #e8b04b; outline-offset: 2px; }
.ico { display: grid; place-items: center; }
.ico svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.l .kick .ico { animation: kickL .45s cubic-bezier(.3, 1.4, .5, 1); }
.r .kick .ico { animation: kickR .45s cubic-bezier(.3, 1.4, .5, 1); }
@keyframes kickL { 0% { transform: rotate(0); } 40% { transform: rotate(-70deg); } 100% { transform: rotate(0); } }
@keyframes kickR { 0% { transform: rotate(0); } 40% { transform: rotate(70deg); } 100% { transform: rotate(0); } }
.amt { color: #e8b04b; min-width: 2.4ch; text-align: center; }
.amt.swap { animation: swap .26s ease-out; }
@keyframes swap { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.nb { all: unset; box-sizing: border-box; position: absolute; left: 50%; height: 34px; padding: 0 15px; border-radius: 999px; white-space: nowrap;
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; ${GLASS}
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: transform .2s ease-in, opacity .14s ease-in, visibility 0s linear .2s, background .15s; }
.nb.up { bottom: calc(100% + 8px); transform: translate(-50%, 8px) scale(.9); }
.nb.down { top: calc(100% + 8px); transform: translate(-50%, -8px) scale(.9); }
.side.pick .nb.has { opacity: .92; visibility: visible; pointer-events: auto; transform: translate(-50%, 0);
  transition: transform .3s cubic-bezier(.2, 1.2, .3, 1), opacity .16s ease-out, visibility 0s, background .15s; }
.side.pick .nb.has:hover { opacity: 1; background: rgba(48, 56, 66, .92); }
@media (prefers-reduced-motion: reduce) {
  .handle, .handle.on, .nb, .side.pick .nb.has { transition: opacity .15s linear, visibility 0s; transform: none; }
  .nb.up, .nb.down, .side.pick .nb.has { transform: translate(-50%, 0); }
  .kick .ico, .amt.swap { animation: none !important; }
  .float.go { animation: fade 900ms linear forwards; }
  @keyframes fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
}`;

interface Side {
  dir: 1 | -1;
  el: HTMLElement;
  handle: HTMLButtonElement;
  amount: HTMLElement;
  float: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
}

export const pills: StyleDef = {
  wakes: true,
  altWheel: false,
  css,
  html: side('l', ICON_BACK) + side('r', ICON_FWD),
  create(ctx): StyleView {
    const root = ctx.root;
    const make = (cls: 'l' | 'r', dir: 1 | -1): Side => {
      const el = root.querySelector<HTMLElement>(`.side.${cls}`)!;
      return {
        dir,
        el,
        handle: el.querySelector('.handle')!,
        amount: el.querySelector('.amt')!,
        float: el.querySelector('.float')!,
        up: el.querySelector('.nb.up')!,
        down: el.querySelector('.nb.down')!,
      };
    };
    const left = make('l', -1);
    const right = make('r', 1);
    const sides = [left, right];
    let leave: ReturnType<typeof setTimeout> | undefined;
    let lastWheel = 0;

    const open = (s: Side) => {
      clearTimeout(leave);
      if (!s.handle.classList.contains('on')) return;
      s.el.classList.add('pick');
      ctx.hold(true);
    };
    const close = (s: Side) => {
      clearTimeout(leave);
      leave = setTimeout(() => {
        s.el.classList.remove('pick');
        ctx.hold(false);
      }, LEAVE_MS);
    };

    for (const s of sides) {
      // Pressing must not take focus from the player, or its own keys stop working.
      s.el.addEventListener('mousedown', (e) => e.preventDefault());
      s.handle.addEventListener('click', () => ctx.jump(s.dir));
      for (const nb of [s.up, s.down]) nb.addEventListener('click', () => ctx.pick(Number(nb.dataset.seconds)));
      s.el.addEventListener('mouseover', () => open(s));
      s.el.addEventListener('mouseout', () => close(s));
      s.el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          if (now - lastWheel < WHEEL_GAP_MS || e.deltaY === 0) return;
          lastWheel = now;
          ctx.step(e.deltaY < 0 ? 1 : -1);
        },
        { passive: false },
      );
    }

    const label = (el: HTMLElement, text: string) => {
      if (el.textContent === text) return;
      el.textContent = text;
      restart(el, 'swap');
    };

    return {
      place(r: Rect) {
        const midY = (r.top + r.bottom) / 2;
        for (const s of sides) s.el.style.top = `${midY - PILL_HEIGHT / 2}px`;
        left.el.style.left = `${r.left + EDGE}px`;
        right.el.style.left = `${r.right - EDGE}px`;
      },
      show() {
        for (const s of sides) s.handle.classList.add('on');
      },
      hide() {
        for (const s of sides) {
          s.handle.classList.remove('on');
          s.el.classList.remove('pick');
        }
      },
      render(p: PanelSettings) {
        const amount = jumpLabel(p.selected);
        const near = neighbours(p);
        for (const s of sides) {
          label(s.amount, amount);
          const name = tr(s.dir < 0 ? 'panelBack' : 'panelForward', { amount });
          s.handle.setAttribute('aria-label', name);
          s.handle.title = `${name} · ${tr('panelChangeAmount')}`;
          for (const [nb, seconds] of [[s.up, near.higher], [s.down, near.lower]] as const) {
            nb.classList.toggle('has', seconds !== null);
            nb.dataset.seconds = String(seconds ?? '');
            nb.textContent = seconds === null ? '' : jumpLabel(seconds);
            if (seconds !== null) nb.setAttribute('aria-label', tr('pickAmount', { amount: jumpLabel(seconds) }));
          }
        }
      },
      press(dir) {
        const s = dir < 0 ? left : right;
        restart(s.handle, 'kick');
        setTimeout(() => s.handle.classList.remove('kick'), 500);
      },
      jumped(e) {
        const s = e.dir < 0 ? left : right;
        s.float.textContent = signed(e.dir, jumpLabel(e.total));
        restart(s.float, 'go');
      },
      tipAt(r) {
        return { x: r.right - EDGE, y: (r.top + r.bottom) / 2 + PILL_HEIGHT / 2 + 56, align: 'end' };
      },
    };
  },
};
