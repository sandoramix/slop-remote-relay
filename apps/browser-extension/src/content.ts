import type { NavStatus } from '@relay/protocol';
import { currentIndex, type NavEntry, type NavPlan, planApplies, stepIndex } from './nav';
import type { ActionResult, FrameAction, MediaReport, NavReadResult, NavResult } from './shared';

/**
 * Runs in every frame. Finds the frame's main <video> and does what it is told
 * with it. Everything here works without a user gesture — seeking, pausing,
 * leaving fullscreen. Entering fullscreen does not, which is why the service
 * worker handles that one through the debugger.
 */

/** The most prominent video: playing beats paused, then the largest on screen. */
function mainVideo(): HTMLVideoElement | null {
  const videos = [...document.querySelectorAll('video')];
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area < 100 && document.fullscreenElement !== v) continue;
    const score = area + (v.paused ? 0 : 1e9) + (v.readyState > 0 ? 1e6 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

function report(): MediaReport {
  const v = mainVideo();
  const r = v?.getBoundingClientRect();
  const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : null);
  const duration = finite(v?.duration);
  return {
    hasMedia: !!v,
    playing: !!v && !v.paused && !v.ended,
    positionMs: v ? Math.round(v.currentTime * 1000) : null,
    durationMs: duration !== null ? Math.round(duration * 1000) : null,
    title: navigator.mediaSession?.metadata?.title || document.title || null,
    fullscreen: !!document.fullscreenElement,
    area: r ? Math.round(r.width * r.height) : 0,
    url: location.href,
  };
}

function seekTo(v: HTMLVideoElement, ms: number): string {
  const max = Number.isFinite(v.duration) ? v.duration * 1000 - 250 : Infinity;
  const target = Math.min(Math.max(0, ms), max);
  v.currentTime = target / 1000;
  return `currentTime ${Math.round(target)}ms`;
}

// ------------------------------------------------------------ navigation

const MAX_NAV_ITEMS = 2000;

function readEntries(plan: NavPlan): NavEntry[] {
  if (!plan.items) return [];
  const labelOf = (el: Element) =>
    (!plan.label || plan.label === 'text' ? el.textContent : el.getAttribute(plan.label))?.trim() ?? '';
  return [...document.querySelectorAll(plan.items)].slice(0, MAX_NAV_ITEMS).map((el) => ({
    label: labelOf(el),
    href: el instanceof HTMLAnchorElement && el.href ? el.href : null,
    current: !!plan.current && el.matches(plan.current),
  }));
}

/** A page control that can be pressed: present, not disabled, not hidden. */
function usable(selector: string | undefined): HTMLElement | null {
  const el = selector ? document.querySelector<HTMLElement>(selector) : null;
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
  return el.getClientRects().length > 0 ? el : null;
}

function navRead(plan: NavPlan, withItems: boolean): NavReadResult {
  if (!planApplies(plan, location.pathname)) return null;
  const entries = readEntries(plan);
  if (entries.length === 0) {
    if (!usable(plan.next) && !usable(plan.prev)) return null;
    return { current: null, hasPrev: !!usable(plan.prev), hasNext: !!usable(plan.next) };
  }
  const index = currentIndex(entries, location.href);
  const status: NavStatus = {
    current: index !== null ? entries[index]!.label : null,
    hasPrev: stepIndex(entries.length, index, -1) !== null,
    hasNext: stepIndex(entries.length, index, 1) !== null,
    index,
    count: entries.length,
  };
  if (withItems) status.items = entries.map((e) => e.label);
  return status;
}

/** Opens an entry, or answers with its address for the worker to open. */
function open(entry: NavEntry): NavResult {
  if (!entry.href) return { ok: false, detail: `"${entry.label}" is not a link` };
  return { ok: true, href: entry.href, detail: `episode ${entry.label}` };
}

function navStep(plan: NavPlan, delta: 1 | -1): NavResult {
  if (!planApplies(plan, location.pathname)) return { ok: false, detail: 'navigation is not available on this page' };
  const entries = readEntries(plan);
  if (entries.length > 0) {
    const index = currentIndex(entries, location.href);
    if (index === null) return { ok: false, detail: 'cannot tell which episode this is' };
    const to = stepIndex(entries.length, index, delta);
    return to === null ? { ok: false, detail: delta > 0 ? 'already at the last episode' : 'already at the first episode' } : open(entries[to]!);
  }
  const button = usable(delta > 0 ? plan.next : plan.prev);
  if (!button) return { ok: false, detail: delta > 0 ? 'no next episode' : 'no previous episode' };
  // Answer first: the click usually unloads this page, and a reply sent after that is lost.
  setTimeout(() => button.click(), 50);
  return { ok: true, detail: delta > 0 ? 'next' : 'previous' };
}

function navGoto(plan: NavPlan, index: number, label: string): NavResult {
  const entry = readEntries(plan)[index];
  if (!entry || entry.label !== label) return { ok: false, detail: 'the episode list changed; refresh and pick again' };
  return open(entry);
}

async function perform(action: FrameAction): Promise<ActionResult | MediaReport | NavResult | NavReadResult> {
  if (action.kind === 'report') return report();
  if (action.kind === 'navRead') return navRead(action.plan, action.withItems);
  if (action.kind === 'navStep') return navStep(action.plan, action.delta);
  if (action.kind === 'navGoto') return navGoto(action.plan, action.index, action.label);
  if (action.kind === 'startPlayer') {
    const control = usable(action.selector);
    if (!control) return { ok: false, detail: `no start control (${action.selector}) on this page` };
    // Answer first, as for navigation: a click may open popups or replace the frame.
    setTimeout(() => control.click(), 50);
    return { ok: true, detail: `clicked ${action.selector}` };
  }
  if (action.kind === 'exitFullscreen') {
    if (!document.fullscreenElement) return { ok: true, detail: 'already out of fullscreen' };
    await document.exitFullscreen();
    return { ok: true, detail: 'exitFullscreen' };
  }

  const v = mainVideo();
  if (!v) return { ok: false, detail: 'no video on this page' };

  switch (action.kind) {
    case 'seek':
      return { ok: true, detail: seekTo(v, v.currentTime * 1000 + action.deltaMs) };
    case 'seekTo':
      return { ok: true, detail: seekTo(v, action.positionMs) };
    case 'playPause': {
      const play = action.play ?? v.paused;
      if (play) await v.play();
      else v.pause();
      return { ok: true, detail: play ? 'play' : 'pause' };
    }
  }
}

type Relay = { report: () => MediaReport; alive: () => boolean };
const scope = globalThis as unknown as { __relay?: Relay };

/**
 * The worker also injects this file into tabs that were open before the
 * extension was installed or reloaded, which the manifest never reaches. A copy
 * left over from a previous version of the extension is orphaned (its runtime
 * is gone, so its listener never hears anything); a live copy means this frame
 * is already covered and registering twice would answer every message twice.
 */
function boot(): void {
  if (scope.__relay?.alive()) return;

  // The worker reads every frame at once through scripting.executeScript, which
  // runs in this same isolated world and can call these.
  scope.__relay = { report, alive: () => !!chrome.runtime?.id };

  chrome.runtime.onMessage.addListener((msg: { relay?: FrameAction }, _sender, respond) => {
    if (!msg.relay) return false;
    perform(msg.relay)
      .then(respond)
      .catch((e: Error) => respond({ ok: false, detail: e.message }));
    return true;
  });

  // Tell the worker when something changes, so the remote updates without polling hard.
  let last = '';
  const notify = () => {
    const r = report();
    const summary = `${r.hasMedia}|${r.playing}|${r.fullscreen}|${r.title}`;
    if (summary === last) return;
    last = summary;
    void chrome.runtime.sendMessage({ mediaChanged: true }).catch(() => undefined);
  };
  for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'seeked']) {
    document.addEventListener(ev, notify, true);
  }
  document.addEventListener('fullscreenchange', notify);
}

boot();
