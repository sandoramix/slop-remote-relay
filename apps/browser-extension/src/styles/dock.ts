import { jumpLabel } from '@relay/protocol';
import { chips, type PanelSettings } from '../panel';
import { tr } from '../shared';
import { GLASS, ICON_BACK, ICON_FWD, restart, signed, type Rect, type StyleDef, type StyleView } from './types';

/**
 * Side dock: one slim tab on the video's right edge, the only thing that
 * shows. Hovering it opens a card with back and forward and every amount as a
 * chip, so nothing has to be known in advance; it closes again when the pointer
 * leaves.
 */

const LEAVE_MS = 320;
const TAB_W = 30;
const TAB_H = 76;

const html = `
  <div class="dock"><div class="float"></div>
    <div class="card" role="group">
      <div class="jumps">
        <button class="b back" type="button"><span class="ico">${ICON_BACK}</span><span class="lbl"></span></button>
        <button class="b fwd" type="button"><span class="lbl"></span><span class="ico">${ICON_FWD}</span></button>
      </div>
      <div class="chips"></div>
    </div>
    <button class="tab" type="button" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/></svg>
    </button>
  </div>`;

const css = `
.dock { position: absolute; width: ${TAB_W}px; height: ${TAB_H}px; transform: translateX(-100%); }
.tab { all: unset; box-sizing: border-box; position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer;
  border-radius: 16px 0 0 16px; ${GLASS} border-right: 0;
  opacity: 0; visibility: hidden; pointer-events: none; transform: translateX(100%);
  transition: transform .26s ease-in, opacity .18s ease-in, visibility 0s linear .26s, background .15s; }
.dock.on .tab { opacity: 1; visibility: visible; pointer-events: auto; transform: none;
  transition: transform .42s cubic-bezier(.2, 1.1, .3, 1), opacity .22s ease-out, visibility 0s, background .15s; }
.dock.on .tab:hover, .dock.open .tab { background: rgba(32, 38, 46, .85); }
.tab svg { width: 18px; height: 18px; fill: none; stroke: #e8b04b; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;
  transition: transform .3s cubic-bezier(.2, 1.1, .3, 1); }
.dock.open .tab svg { transform: scaleX(-1); }
.tab.kick svg { animation: nudge .4s cubic-bezier(.3, 1.4, .5, 1); }
@keyframes nudge { 40% { transform: translateX(-5px); } }
.tab:focus-visible, .b:focus-visible, .chip:focus-visible { outline: 2px solid #e8b04b; outline-offset: 2px; }
.card { position: absolute; right: calc(100% + 8px); top: 50%; width: max-content; max-width: 268px; display: flex; flex-direction: column;
  gap: 10px; padding: 12px; border-radius: 18px; ${GLASS}
  opacity: 0; visibility: hidden; pointer-events: none; transform-origin: right center; transform: translate(14px, -50%) scale(.94);
  transition: transform .2s ease-in, opacity .14s ease-in, visibility 0s linear .2s; }
.dock.open .card { opacity: 1; visibility: visible; pointer-events: auto; transform: translate(0, -50%);
  transition: transform .38s cubic-bezier(.2, 1.15, .3, 1), opacity .18s ease-out, visibility 0s; }
.jumps { display: flex; gap: 8px; }
.b { all: unset; box-sizing: border-box; flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; height: 44px;
  padding: 0 16px; border-radius: 12px; background: rgba(255, 255, 255, .1); cursor: pointer; font-weight: 600;
  font-variant-numeric: tabular-nums; white-space: nowrap; transition: background .15s, transform .1s; }
.b:hover { background: rgba(255, 255, 255, .18); }
.b:active { transform: scale(.95); }
.b .ico svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.chip { all: unset; box-sizing: border-box; height: 28px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums; cursor: pointer; border: 1px solid rgba(255, 255, 255, .16); transition: background .15s; }
.chip:hover { background: rgba(255, 255, 255, .12); }
.chip.sel { background: rgba(232, 176, 75, .22); border-color: #e8b04b; color: #e8b04b; }
.float { position: absolute; bottom: calc(100% + 8px); right: 0; white-space: nowrap; font-size: 22px; font-weight: 700;
  font-variant-numeric: tabular-nums; text-shadow: 0 2px 10px rgba(0, 0, 0, .55); opacity: 0; }
.float.go { animation: rise 900ms cubic-bezier(.2, .7, .2, 1) forwards; }
@keyframes rise { 0% { opacity: 0; transform: translateY(8px) scale(.9); } 18% { opacity: 1; transform: none; }
  70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
@media (prefers-reduced-motion: reduce) {
  .tab, .dock.on .tab, .card, .dock.open .card { transition: opacity .15s linear, visibility 0s; transform: none; }
  .card, .dock.open .card { transform: translate(0, -50%); }
  .tab.kick svg { animation: none; }
  .float.go { animation: fade 900ms linear forwards; }
  @keyframes fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
}`;

export const dock: StyleDef = {
  wakes: true,
  altWheel: false,
  css,
  html,
  create(ctx): StyleView {
    const root = ctx.root;
    const el = root.querySelector<HTMLElement>('.dock')!;
    const tab = el.querySelector<HTMLButtonElement>('.tab')!;
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    const fwd = el.querySelector<HTMLButtonElement>('.fwd')!;
    const chipsEl = el.querySelector<HTMLElement>('.chips')!;
    const float = el.querySelector<HTMLElement>('.float')!;
    let leave: ReturnType<typeof setTimeout> | undefined;
    let lastWheel = 0;

    const open = () => {
      clearTimeout(leave);
      if (!el.classList.contains('on')) return;
      el.classList.add('open');
      tab.setAttribute('aria-expanded', 'true');
      ctx.hold(true);
    };
    const close = (now = false) => {
      clearTimeout(leave);
      const run = () => {
        el.classList.remove('open');
        tab.setAttribute('aria-expanded', 'false');
        ctx.hold(false);
      };
      if (now) run();
      else leave = setTimeout(run, LEAVE_MS);
    };

    // Pressing must not take focus from the player, or its own keys stop working.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('mouseover', open);
    el.addEventListener('mouseout', () => close());
    // A tap or a key press on the tab opens it too, for anyone who is not hovering.
    tab.addEventListener('click', () => (el.classList.contains('open') ? close(true) : open()));
    back.addEventListener('click', () => ctx.jump(-1));
    fwd.addEventListener('click', () => ctx.jump(1));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - lastWheel < 140 || e.deltaY === 0) return;
        lastWheel = now;
        ctx.step(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );

    return {
      place(r: Rect) {
        el.style.left = `${r.right}px`;
        el.style.top = `${(r.top + r.bottom) / 2 - TAB_H / 2}px`;
      },
      show() {
        el.classList.add('on');
      },
      hide() {
        el.classList.remove('on');
        close(true);
      },
      render(p: PanelSettings) {
        const amount = jumpLabel(p.selected);
        back.querySelector('.lbl')!.textContent = signed(-1, amount);
        fwd.querySelector('.lbl')!.textContent = signed(1, amount);
        back.setAttribute('aria-label', tr('panelBack', { amount }));
        fwd.setAttribute('aria-label', tr('panelForward', { amount }));
        tab.setAttribute('aria-label', tr('dockOpen'));
        tab.title = tr('dockOpen');
        chipsEl.replaceChildren(
          ...chips(p).map((seconds) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `chip${seconds === p.selected ? ' sel' : ''}`;
            b.textContent = jumpLabel(seconds);
            b.setAttribute('aria-label', tr('pickAmount', { amount: jumpLabel(seconds) }));
            b.addEventListener('click', () => ctx.pick(seconds));
            return b;
          }),
        );
      },
      press() {
        restart(tab, 'kick');
        setTimeout(() => tab.classList.remove('kick'), 450);
      },
      jumped(e) {
        float.textContent = signed(e.dir, jumpLabel(e.total));
        restart(float, 'go');
      },
      tipAt(r) {
        return { x: r.right - TAB_W - 8, y: (r.top + r.bottom) / 2 + TAB_H / 2 + 14, align: 'end' };
      },
    };
  },
};
