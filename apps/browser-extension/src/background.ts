import type { Command, DeviceStatus, ExecutorId } from '@relay/protocol';
import sites from './sites.json';
import { type ActionResult, type FrameAction, loadSettings, type MediaReport, type RuntimeMessage } from './shared';

/**
 * The service worker: owns the tabs. The offscreen document hands it verified
 * commands; it finds the tab and frame with the video that matters and acts.
 *
 * Everything except entering fullscreen is done by the content script, with no
 * special permission. Entering fullscreen needs a user gesture that no
 * extension API grants, so it goes through the DevTools protocol: attach the
 * debugger for a moment, send a real key press or a gesture-flagged evaluate,
 * detach. Chrome shows its "is debugging this browser" bar while attached —
 * the price of the one action a page will only take from a person.
 */

type SiteRecipe = { fullscreenKey?: string; exitKey?: string; seekApi?: string };
const SITES = sites as unknown as Record<string, SiteRecipe>;

function siteFor(url: string): SiteRecipe | null {
  try {
    const host = new URL(url).hostname;
    const key = Object.keys(SITES).find((d) => !d.startsWith('_') && (host === d || host.endsWith(`.${d}`)));
    return key ? SITES[key]! : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- offscreen

const OFFSCREEN = 'offscreen.html';

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['WEB_RTC' as chrome.offscreen.Reason],
    justification: 'Keeps the connections to the paired phone open, including a WebRTC data channel.',
  });
}

async function configureOffscreen(): Promise<void> {
  await ensureOffscreen();
  const settings = await loadSettings();
  await chrome.runtime.sendMessage({ to: 'offscreen', type: 'configure', settings } satisfies RuntimeMessage);
}

chrome.runtime.onInstalled.addListener(() => void configureOffscreen());
chrome.runtime.onStartup.addListener(() => void configureOffscreen());
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) void configureOffscreen();
});
// The worker may start for any reason (a message, an alarm); make sure the
// receiver is up whenever it does.
void configureOffscreen();

// --------------------------------------------------------------- targets

interface Target {
  tabId: number;
  frameId: number;
  windowId: number;
  report: MediaReport;
}

async function frameReports(tab: chrome.tabs.Tab): Promise<Target[]> {
  if (!tab.id || !tab.url || !/^https?:|^file:/.test(tab.url)) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (globalThis as unknown as { __relay?: { report: () => unknown } }).__relay?.report() ?? null,
    });
    return results
      .filter((r) => r.result)
      .map((r) => ({ tabId: tab.id!, frameId: r.frameId, windowId: tab.windowId, report: r.result as MediaReport }));
  } catch {
    return [];
  }
}

/**
 * The video the user means: audible tabs first, then each window's active tab;
 * within those, a playing video beats a paused one and a large one beats a
 * small one. Falls back to the active tab of the focused window.
 */
async function pickTarget(): Promise<Target | null> {
  const [audible, active] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    chrome.tabs.query({ active: true }),
  ]);
  const seen = new Set<number>();
  const tabs = [...audible, ...active].filter((t) => t.id && !seen.has(t.id) && seen.add(t.id));
  const reports = (await Promise.all(tabs.map(frameReports))).flat().filter((t) => t.report.hasMedia);
  if (reports.length === 0) {
    const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const any = focused ? await frameReports(focused) : [];
    return any.find((t) => t.frameId === 0) ?? any[0] ?? null;
  }
  const score = (t: Target) =>
    (t.report.playing ? 1e12 : 0) + (audible.some((a) => a.id === t.tabId) ? 1e11 : 0) + t.report.area;
  return reports.sort((a, b) => score(b) - score(a))[0]!;
}

const toFrame = <T>(t: Target, action: FrameAction) =>
  chrome.tabs.sendMessage(t.tabId, { relay: action }, { frameId: t.frameId }) as Promise<T>;

// --------------------------------------------------------------- execute

async function hasDebugger(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['debugger'] });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attaches the debugger to a tab for the duration of `fn`, always detaching. */
type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

async function withDebugger<T>(tabId: number, fn: (send: Send) => Promise<T>): Promise<T> {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    return await fn((method, params) => chrome.debugger.sendCommand(target, method, params));
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

/** A real key press, which counts as a user activation for the page. */
async function pressKey(send: Send, key: string): Promise<void> {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text: key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}

/**
 * Generic fullscreen: the largest element that tightly wraps the main video
 * (the player, so its own controls come along), or the video itself; for a
 * video inside a frame, that frame's element. Run with userGesture so the
 * Fullscreen API accepts it.
 */
const GENERIC_FULLSCREEN = `(() => {
  const vids = [...document.querySelectorAll('video')];
  const frames = [...document.querySelectorAll('iframe')];
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  let v = vids.sort((a, b) => (b.paused ? 0 : 1e9) + area(b) - ((a.paused ? 0 : 1e9) + area(a)))[0];
  let el = v;
  if (!v || area(v) < 100) el = frames.sort((a, b) => area(b) - area(a))[0];
  if (!el) return 'no-video';
  if (v && el === v) {
    let p = v.parentElement;
    while (p && p !== document.body && area(p) <= area(v) * 1.35) { el = p; p = p.parentElement; }
  }
  return el.requestFullscreen({ navigationUI: 'hide' }).then(() => 'ok', (e) => 'refused: ' + e.message);
})()`;

async function enterFullscreen(t: Target): Promise<ActionResult & { executedBy?: ExecutorId }> {
  if (!(await hasDebugger())) {
    return { ok: false, detail: 'Apri il popup di Relay e consenti il permesso "debugger" per lo schermo intero' };
  }
  const recipe = siteFor(t.report.url);
  await chrome.tabs.update(t.tabId, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });

  const how = await withDebugger(t.tabId, async (send) => {
    if (recipe?.fullscreenKey) {
      await pressKey(send, recipe.fullscreenKey);
      return `tasto "${recipe.fullscreenKey}"`;
    }
    const res = (await send('Runtime.evaluate', {
      expression: GENERIC_FULLSCREEN,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: string } };
    return `requestFullscreen (${res.result?.value ?? '?'})`;
  });

  await sleep(600);
  const after = await pickTarget();
  const ok = !!after?.report.fullscreen;
  return { ok, executedBy: 'cdp', detail: ok ? how : `${how}: la pagina non è andata a schermo intero` };
}

async function exitFullscreen(t: Target): Promise<ActionResult & { executedBy?: ExecutorId }> {
  const res = await toFrame<ActionResult>(t, { kind: 'exitFullscreen' });
  return { ...res, executedBy: 'dom' };
}

async function execute(cmd: Command): Promise<ActionResult & { executedBy?: ExecutorId }> {
  const t = await pickTarget();
  if (!t) return { ok: false, detail: 'Nessuna scheda con un video' };

  switch (cmd.op) {
    case 'playback.seek':
    case 'playback.seekTo': {
      const target =
        cmd.op === 'playback.seek' ? (t.report.positionMs ?? 0) + cmd.deltaMs : cmd.positionMs;
      if (siteFor(t.report.url)?.seekApi === 'netflix') {
        await chrome.scripting.executeScript({
          target: { tabId: t.tabId, frameIds: [t.frameId] },
          world: 'MAIN',
          args: [Math.max(0, Math.round(target))],
          func: (ms: number) => {
            // Netflix's own player API; writing currentTime crashes its player.
            const w = window as unknown as { netflix: any };
            const api = w.netflix.appContext.state.playerApp.getAPI().videoPlayer;
            api.getVideoPlayerBySessionId(api.getAllPlayerSessionIds()[0]).seek(ms);
          },
        });
        return { ok: true, executedBy: 'dom', detail: `seek Netflix ${Math.round(target)}ms` };
      }
      const res = await toFrame<ActionResult>(t, { kind: 'seekTo', positionMs: target });
      return { ...res, executedBy: 'dom' };
    }
    case 'playback.playPause': {
      const res = await toFrame<ActionResult>(t, { kind: 'playPause', play: cmd.play });
      return { ...res, executedBy: 'dom' };
    }
    case 'fullscreen.enter':
      return cmd.toggle && t.report.fullscreen ? exitFullscreen(t) : enterFullscreen(t);
    case 'fullscreen.exit':
      return exitFullscreen(t);
    default:
      return { ok: false, detail: `operazione non supportata: ${cmd.op}` };
  }
}

async function status(): Promise<DeviceStatus> {
  const t = await pickTarget();
  const executors: ExecutorId[] = ['dom', ...((await hasDebugger()) ? (['cdp'] as const) : [])];
  const battery = await (navigator as unknown as { getBattery?: () => Promise<{ level: number }> })
    .getBattery?.()
    .catch(() => null);
  return {
    kind: 'browser',
    foregroundPackage: t?.report.url ?? null,
    hasMediaSession: !!t?.report.hasMedia,
    positionMs: t?.report.positionMs ?? null,
    durationMs: t?.report.durationMs ?? null,
    isPlaying: !!t?.report.playing,
    executors,
    recipeKnown: !!(t && siteFor(t.report.url)),
    batteryPercent: battery ? Math.round(battery.level * 100) : null,
    title: t?.report.title ?? null,
    fullscreen: t?.report.fullscreen ?? null,
  };
}

// ----------------------------------------------------------------- wiring

let pushTimer: ReturnType<typeof setTimeout> | null = null;

chrome.runtime.onMessage.addListener((msg: RuntimeMessage | { mediaChanged?: true }, _sender, respond) => {
  if (!('to' in msg)) {
    // Coalesce bursts (play + seeked + loadedmetadata) into one push.
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      await chrome.runtime
        .sendMessage({ to: 'offscreen', type: 'broadcastStatus', status: await status() } satisfies RuntimeMessage)
        .catch(() => undefined);
    }, 400);
    return false;
  }
  if (msg.to !== 'worker') return false;
  if (msg.type === 'execute') {
    execute(msg.cmd as Command)
      .then(respond)
      .catch((e: Error) => respond({ ok: false, detail: e.message }));
    return true;
  }
  if (msg.type === 'status') {
    void status().then(respond);
    return true;
  }
  return false;
});
