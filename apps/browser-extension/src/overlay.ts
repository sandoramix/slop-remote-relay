import { jumpLabel } from '@relay/protocol';
import {
  actionFor,
  addToRun,
  formatCombo,
  hostOff,
  jumpCommand,
  landing,
  type PanelSettings,
  type PanelStyle,
  type Run,
  stepAmount,
  wantsHint,
} from './panel';
import { isLanguage, loadLanguage, setLanguage } from './i18n';
import { type ActionResult, loadPanel, type RuntimeMessage, savePanel, tr } from './shared';
import { dock } from './styles/dock';
import { gesture } from './styles/gesture';
import { pills } from './styles/pills';
import { timeline } from './styles/timeline';
import { GLASS, type Rect, type StyleDef, type StyleView } from './styles/types';

/**
 * The skip panel inside a page: the shortcuts, the look chosen in the popup
 * (src/styles), and the feedback that confirms a jump. All of it only ever
 * sends `playback.seek` to the service worker, which picks the tab and frame
 * and seeks the way it does for the phone, so the two can be used side by side.
 *
 * This file is what every style shares: the settings, the keys, Alt + scroll,
 * where the video is, the fullscreen re-parenting, and the one-time tip that
 * teaches the style until the person has used it. Quiet by design: nothing
 * is drawn until the pointer moves over a video (or a jump happens), and every
 * key the panel answers needs a modifier, so the site's own keys are untouched.
 */

const STYLES: Record<PanelStyle, StyleDef> = { pills, dock, gesture, timeline };

const SHOW_MS = 2600;
const OSD_MS = 1100;
const TIP_MS = 6500;
/** Taps closer together than this add up into one number: +30s, +1m, ... */
const ACCUMULATE_MS = 1200;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 135;
/** Held shortcuts repeat, but never faster than the worker can answer. */
const MIN_GAP_MS = 220;
/**
 * A mouse notch reports 100 or so (53 on some Linux setups) and is one jump; a
 * trackpad reports many small steps, which add up to one jump each time they
 * reach this.
 */
const NOTCH = 50;
const MAX_NOTCHES = 20;
const IS_MAC = /Mac/i.test(navigator.platform);

const BASE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 15px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
svg { display: block; }
.osd { position: absolute; transform: translate(-50%, -50%) scale(.92); padding: 9px 18px; border-radius: 999px;
  font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0; visibility: hidden; ${GLASS}
  transition: opacity .18s ease-in, transform .22s ease-in, visibility 0s linear .22s; }
.osd.on { opacity: 1; visibility: visible; transform: translate(-50%, -50%);
  transition: opacity .16s ease-out, transform .32s cubic-bezier(.2, 1.2, .3, 1), visibility 0s; }
.tip { --tx: -50%; position: absolute; width: max-content; max-width: 320px; padding: 11px 16px; border-radius: 14px; font-size: 13px; line-height: 1.4;
  text-align: center; opacity: 0; visibility: hidden; ${GLASS} transform: translate(var(--tx), 10px);
  transition: opacity .25s ease-in, transform .3s ease-in, visibility 0s linear .3s; }
.tip[data-align="end"] { --tx: -100%; text-align: right; }
.tip[data-align="start"] { --tx: 0%; text-align: left; }
.tip.on { opacity: 1; visibility: visible; transform: translate(var(--tx), 0);
  transition: opacity .35s ease-out, transform .5s cubic-bezier(.2, 1.1, .3, 1), visibility 0s; }
@media (prefers-reduced-motion: reduce) {
  .osd, .osd.on, .tip, .tip.on { transition: opacity .15s linear, visibility 0s; }
  .osd, .osd.on { transform: translate(-50%, -50%); }
  .tip, .tip.on { transform: translate(var(--tx), 0); }
}
`;

/** The hostname the person sees in the address bar: the top page's, from inside a frame. */
function pageHost(): string {
  const top = location.ancestorOrigins?.[location.ancestorOrigins.length - 1];
  try {
    return new URL(top ?? location.href).hostname;
  } catch {
    return location.hostname;
  }
}

const live = (): boolean => !!chrome.runtime?.id;

function editable(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || (el as HTMLElement).isContentEditable;
}

export function startPanel(mainVideo: () => HTMLVideoElement | null): void {
  let panel: PanelSettings | null = null;
  let host: HTMLElement | null = null;
  let def: StyleDef | null = null;
  let view: StyleView | null = null;
  let osd: HTMLElement;
  let tip: HTMLElement;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let osdTimer: ReturnType<typeof setTimeout> | undefined;
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let inVideo = false;
  let busy = false;
  let lastAt = 0;
  let moveQueued = false;
  let tipShown = false;
  let run: Run | null = null;
  let pending = 0;
  let wheelAcc = 0;
  let lastAmountWheel = 0;

  const off = (): boolean => !panel || hostOff(panel.offHosts, pageHost());
  const apply = (next: Partial<PanelSettings>): void => {
    panel = { ...panel!, ...next };
    void savePanel(panel).catch(() => undefined);
    view?.render(panel);
  };

  /** The visible part of the main video, or null when there is none worth drawing on. */
  function rect(): Rect | null {
    const r = mainVideo()?.getBoundingClientRect();
    if (!r || r.width < MIN_WIDTH || r.height < MIN_HEIGHT) return null;
    return { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
  }

  const position = () => {
    const v = mainVideo();
    return { ms: v ? Math.round(v.currentTime * 1000) : null, duration: v && Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null };
  };

  // ------------------------------------------------------------ actions

  /** The person has found a way to do it: the tip has done its job. */
  function markUsed(): void {
    hideTip();
    if (panel && !panel.hints.done) apply({ hints: { ...panel.hints, done: true } });
  }

  async function jump(dir: 1 | -1, count = 1): Promise<void> {
    if (!panel || busy || !live()) return;
    busy = true;
    lastAt = Date.now();
    const seconds = panel.selected * count;
    const before = position();
    const placed = prepare();
    if (placed) view?.press?.(dir);
    try {
      const res = (await chrome.runtime.sendMessage({
        to: 'worker',
        type: 'execute',
        cmd: jumpCommand(dir, seconds),
      } satisfies RuntimeMessage)) as ActionResult | undefined;
      if (res?.ok) {
        run = addToRun(run, dir, seconds, Date.now(), ACCUMULATE_MS);
        if (panel.toast && placed) {
          view?.jumped({
            dir,
            seconds,
            total: run.seconds,
            fresh: run.fresh,
            from: before.ms,
            to: before.ms === null ? null : Math.round(landing(before.ms, dir * seconds * 1000, before.duration)),
            duration: before.duration,
          });
        }
      } else say(res?.detail ?? tr('panelNoAnswer'));
    } catch {
      /* the extension was reloaded under this page; the next injection takes over */
    } finally {
      busy = false;
      flush();
    }
  }

  /** Scroll notches wait here while a jump is in flight, then go as one. */
  function flush(): void {
    if (busy || pending === 0) return;
    const n = Math.max(-MAX_NOTCHES, Math.min(MAX_NOTCHES, pending));
    pending = 0;
    void jump(n > 0 ? 1 : -1, Math.abs(n));
  }

  function pick(seconds: number): void {
    if (!panel || seconds === panel.selected) return;
    apply({ selected: seconds });
    markUsed();
  }

  /** `loud`: say it at the centre of the video, for when nothing else on screen shows it. */
  function changeAmount(dir: 1 | -1, loud: boolean): void {
    if (!panel) return;
    const selected = stepAmount(panel.presets, panel.selected, dir);
    if (selected === panel.selected) return;
    apply({ selected });
    markUsed();
    if (loud) say(tr('panelAmount', { amount: jumpLabel(selected) }));
  }

  function toggleOverlay(): void {
    if (!panel) return;
    const next = panel.overlay === 'off' ? 'hover' : 'off';
    apply({ overlay: next });
    if (next === 'off') view?.hide();
    say(tr(next === 'off' ? 'panelOverlayOff' : 'panelOverlayOn'), true);
  }

  // --------------------------------------------------------------- keys

  function onKey(e: KeyboardEvent): void {
    // A copy left behind by a reloaded extension must not swallow keys the live copy wants.
    if (!live() || !panel || off() || e.isComposing || editable(e.target)) return;
    const action = actionFor(panel, e);
    if (!action) return;
    // A frame with no video has nothing to skip, unless it is the page itself.
    if (window !== window.top && !mainVideo()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action === 'overlay') {
      if (!e.repeat) toggleOverlay();
    } else if (action === 'nextAmount' || action === 'prevAmount') {
      if (!e.repeat) changeAmount(action === 'nextAmount' ? 1 : -1, true);
    } else if (Date.now() - lastAt >= MIN_GAP_MS) {
      markUsed();
      void jump(action === 'back' ? -1 : 1);
    }
  }

  /** Holding Alt over the video: a style without buttons shows what scrolling will do. */
  function onAlt(e: KeyboardEvent): void {
    if (e.key !== 'Alt' || !live() || !panel || off() || panel.overlay === 'off') return;
    const style = STYLES[panel.style];
    if (!style.altWheel) return;
    if (e.type === 'keydown') {
      if (e.repeat || !inVideo || !prepare()) return;
      view?.guide?.(true, position());
    } else view?.guide?.(false, position());
  }

  /** Alt + scroll over the video skips; with Shift it changes the amount. */
  function onWheel(e: WheelEvent): void {
    if (!e.altKey || !live() || !panel || off() || panel.overlay === 'off' || !STYLES[panel.style].altWheel) return;
    const r = rect();
    if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault();
    e.stopPropagation();
    // Shift turns a vertical wheel into a horizontal one in Chromium.
    const delta = e.deltaY || e.deltaX;
    if (e.shiftKey) {
      const now = Date.now();
      if (now - lastAmountWheel < 140 || delta === 0) return;
      lastAmountWheel = now;
      changeAmount(delta < 0 ? 1 : -1, true);
      return;
    }
    const dir = delta < 0 ? 1 : -1;
    if (Math.abs(delta) >= NOTCH) {
      pending += dir;
      wheelAcc = 0;
    } else {
      wheelAcc += delta;
      if (Math.abs(wheelAcc) >= NOTCH) {
        pending += wheelAcc < 0 ? 1 : -1;
        wheelAcc = 0;
      }
    }
    if (pending !== 0) {
      markUsed();
      flush();
    }
  }

  // ------------------------------------------------------------ drawing

  function mount(): void {
    if (host || !panel) return;
    def = STYLES[panel.style];
    host = document.createElement('div');
    host.setAttribute('data-skipper', '');
    const root = host.attachShadow({ mode: 'open' }); // open so the smoke test can look inside; a page gains nothing from it
    root.innerHTML = `<style>${BASE}${def.css}</style>
      <div class="layer">${def.html}<div class="osd" role="status" aria-live="polite"></div><div class="tip" role="note"></div></div>`;
    osd = root.querySelector('.osd')!;
    tip = root.querySelector('.tip')!;
    view = def.create({
      root,
      settings: () => panel!,
      jump: (dir) => {
        markUsed();
        void jump(dir);
      },
      pick,
      step: (dir) => changeAmount(dir, false),
      hold: (on) => {
        hovering = on;
        if (on) clearTimeout(hideTimer);
        else armHide();
      },
    });
    attach();
    view.render(panel);
  }

  function unmount(): void {
    clearTimeout(hideTimer);
    clearTimeout(osdTimer);
    clearTimeout(tipTimer);
    host?.remove();
    host = null;
    view = null;
    def = null;
    hovering = false;
  }

  /** Inside the fullscreen element when there is one (it can hold children), else the page. */
  function attach(): void {
    if (!host) return;
    const fs = document.fullscreenElement;
    const parent = fs && !/^(VIDEO|IFRAME|EMBED|OBJECT)$/.test(fs.tagName) ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  /** Mounts if needed and puts the style on the video; false when there is no video worth it. */
  function prepare(): boolean {
    if (!panel || off()) return false;
    mount();
    attach();
    const r = rect();
    if (!r || !view) return false;
    view.place(r);
    osd.style.left = `${(r.left + r.right) / 2}px`;
    osd.style.top = `${(r.top + r.bottom) / 2}px`;
    return true;
  }

  function armHide(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (hovering || host?.shadowRoot?.activeElement) return armHide();
      view?.hide();
    }, SHOW_MS);
  }

  /** Wake the style because the pointer is over the video. */
  function reveal(): void {
    if (!live() || !prepare()) return;
    view?.show();
    armHide();
  }

  /** A short note at the centre of the video. `force`: shown even with feedback off. */
  function say(text: string, force = false): void {
    if (!panel || (!panel.toast && !force) || !prepare()) return;
    osd.textContent = text;
    osd.classList.add('on');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd.classList.remove('on'), OSD_MS);
  }

  /** The one-time tip: what this style does and how, at most a few times and never after it is used. */
  function maybeTip(): void {
    if (tipShown || !panel || !wantsHint(panel) || !prepare()) return;
    const r = rect()!;
    tipShown = true;
    apply({ hints: { ...panel.hints, shown: panel.hints.shown + 1 } });
    tip.textContent = tr(`tip_${panel.style}`, { key: formatCombo(panel.bindings.forward, IS_MAC) });
    const at = view?.tipAt?.(r) ?? { x: (r.left + r.right) / 2, y: r.bottom - 110, align: 'center' as const };
    tip.style.left = `${at.x}px`;
    tip.style.top = `${at.y}px`;
    tip.dataset.align = at.align;
    tip.classList.add('on');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, TIP_MS);
  }

  function hideTip(): void {
    clearTimeout(tipTimer);
    tip?.classList.remove('on');
  }

  function onMove(e: MouseEvent): void {
    if (moveQueued || !panel || panel.overlay === 'off') return;
    moveQueued = true;
    const { clientX: x, clientY: y } = e;
    requestAnimationFrame(() => {
      moveQueued = false;
      const r = rect();
      inVideo = !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (!inVideo || !panel || off()) return;
      if (STYLES[panel.style].wakes) reveal();
      maybeTip();
    });
  }

  // --------------------------------------------------------------- boot

  void loadPanel().then((p) => {
    panel = p;
  });
  void loadLanguage().then(setLanguage);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const language = changes.language?.newValue;
    if (isLanguage(language)) {
      setLanguage(language);
      if (panel) view?.render(panel);
    }
    if (!changes.panel) return;
    void loadPanel().then((p) => {
      const styleChanged = !!def && STYLES[p.style] !== def;
      panel = p;
      if (off() || styleChanged) unmount();
      else {
        if (p.overlay === 'off') view?.hide();
        view?.render(p);
      }
    });
  });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keydown', onAlt, true);
  window.addEventListener('keyup', onAlt, true);
  window.addEventListener('blur', () => view?.guide?.(false, position()));
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('mousemove', onMove, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', attach);
  // Keep the style on the video while the page scrolls or resizes.
  const follow = () => {
    const r = host ? rect() : null;
    if (r) view?.place(r);
  };
  window.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow, { passive: true });
}
