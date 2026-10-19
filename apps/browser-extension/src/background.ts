import type { Command, DeviceStatus, ExecutorId, NavStatus } from '@relay/protocol';
import { compareVersions, LATEST_RELEASE_API, parseRelease, releaseSummary } from '@relay/protocol';
import { type NavPlan } from './nav';
import { isPlayerFrame, needsPlayer, popupTabs, type StartPlan, startedFrames, startPlanFor, startWaitMs } from './start';
import sites from './sites.json';
import {
  type ActionResult,
  type FrameAction,
  type NavReadResult,
  type NavResult,
  loadSettings,
  type MediaReport,
  PRESENCE_WINDOW_MS,
  type ReceiverState,
  type RuntimeMessage,
  isStoreInstall,
  type TargetInfo,
  type UpdateInfo,
} from './shared';

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

type SiteRecipe = { fullscreenKey?: string; exitKey?: string; seekApi?: string; nav?: NavPlan; start?: StartPlan };
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
  /** The address of the tab (the frame's own is in the report). */
  tabUrl: string;
  report: MediaReport;
}

const scriptable = (tab: chrome.tabs.Tab) => !!tab.id && !!tab.url && /^https?:|^file:/.test(tab.url);

/**
 * The manifest's content script only reaches pages loaded after the extension
 * was installed or reloaded; a tab already open has none, or an orphaned one
 * from the previous version that no longer hears messages. Inject it again —
 * it stands down in frames where a live copy is already running.
 */
async function injectContent(tabId: number): Promise<void> {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
    .catch(() => undefined);
}

async function readFrames(tabId: number) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const relay = (globalThis as unknown as { __relay?: { report: () => unknown; alive?: () => boolean } }).__relay;
      return relay?.alive?.() ? relay.report() : null;
    },
  });
}

async function frameReports(tab: chrome.tabs.Tab): Promise<Target[]> {
  if (!scriptable(tab)) return [];
  try {
    let results = await readFrames(tab.id!);
    if (results.some((r) => !r.result)) {
      await injectContent(tab.id!);
      results = await readFrames(tab.id!);
    }
    return results
      .filter((r) => r.result)
      .map((r) => ({ tabId: tab.id!, frameId: r.frameId, windowId: tab.windowId, tabUrl: tab.url!, report: r.result as MediaReport }));
  } catch {
    return [];
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(scriptable).map((t) => injectContent(t.id!)));
});

/**
 * The video the user means: audible tabs first, then each window's active tab;
 * within those, a playing video beats a paused one and a large one beats a
 * small one. Falls back to the active tab of the focused window.
 */
/**
 * The last tab whose content script reported media activity (play, pause,
 * seek). Catches a muted video in a background tab, which is neither audible
 * nor active. Kept in session storage: the worker is restarted often.
 */
async function lastMediaTab(): Promise<chrome.tabs.Tab | null> {
  const { lastMediaTabId } = (await chrome.storage.session.get('lastMediaTabId')) as { lastMediaTabId?: number };
  if (lastMediaTabId === undefined) return null;
  return chrome.tabs.get(lastMediaTabId).catch(() => null);
}

async function pickTarget(): Promise<Target | null> {
  const [audible, active, recent] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    chrome.tabs.query({ active: true }),
    lastMediaTab(),
  ]);
  const seen = new Set<number>();
  const tabs = [...audible, ...(recent ? [recent] : []), ...active].filter(
    (t) => t.id && !seen.has(t.id) && seen.add(t.id),
  );
  const reports = (await Promise.all(tabs.map(frameReports))).flat().filter((t) => t.report.hasMedia);
  if (reports.length === 0) {
    const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const any = focused ? await frameReports(focused) : [];
    return any.find((t) => t.frameId === 0) ?? any[0] ?? null;
  }
  // In a tab where the site's own player frame (named by its start plan) has a
  // video, that is the only candidate: ad banners on the same page play videos
  // too, and a playing ad must not win over a paused episode.
  const withPlayer = new Set(reports.filter(isPlayer).map((t) => t.tabId));
  const candidates = reports.filter((t) => !withPlayer.has(t.tabId) || isPlayer(t));
  const score = (t: Target) =>
    (t.report.playing ? 1e12 : 0) + (audible.some((a) => a.id === t.tabId) ? 1e11 : 0) + t.report.area;
  return candidates.sort((a, b) => score(b) - score(a))[0]!;
}

const isPlayer = (t: Target): boolean => isPlayerFrame(startPlanFor(siteFor(t.tabUrl)?.start, t.tabUrl), t.report.url);

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
  const recipe = siteFor(t.report.url);
  await chrome.tabs.update(t.tabId, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });

  const how = await withDebugger(t.tabId, async (send) => {
    if (recipe?.fullscreenKey) {
      await pressKey(send, recipe.fullscreenKey);
      return `key "${recipe.fullscreenKey}"`;
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
  // Any frame of the tab: when the player is an iframe, the top document is the
  // fullscreen one and the player's own document does not report it.
  const tab = await chrome.tabs.get(t.tabId).catch(() => null);
  const ok = !!tab && (await frameReports(tab)).some((f) => f.report.fullscreen);
  return { ok, executedBy: 'cdp', detail: ok ? how : `${how}: the page did not go fullscreen` };
}

/**
 * Whether the tab is in fullscreen. The top document knows, whichever frame
 * asked for it; a player iframe's own document does not report it.
 */
async function topFullscreen(t: Target): Promise<boolean> {
  if (t.frameId === 0) return t.report.fullscreen;
  const top = await toFrame<MediaReport>({ ...t, frameId: 0 }, { kind: 'report' }).catch(() => null);
  return !!(top?.fullscreen || t.report.fullscreen);
}

async function exitFullscreen(t: Target): Promise<ActionResult & { executedBy?: ExecutorId }> {
  // The top frame: leaving fullscreen there leaves it for every frame.
  const res = await toFrame<ActionResult>({ ...t, frameId: 0 }, { kind: 'exitFullscreen' });
  return { ...res, executedBy: 'dom' };
}

/**
 * Episode navigation. The page's list is in the top frame, which is rarely the
 * frame with the <video> (players are usually iframes), so it is the tab's own
 * address that picks the plan and frame 0 that is asked.
 */
async function navPlanFor(t: Target): Promise<NavPlan | null> {
  const tab = await chrome.tabs.get(t.tabId).catch(() => null);
  return (tab?.url && siteFor(tab.url)?.nav) || null;
}

async function navigate(
  t: Target,
  action: (plan: NavPlan) => FrameAction,
): Promise<ActionResult & { executedBy?: ExecutorId }> {
  const plan = await navPlanFor(t);
  if (!plan) return { ok: false, detail: 'No navigation plan for this site' };
  const res = await toFrame<NavResult>({ ...t, frameId: 0 }, action(plan));
  if (res.ok && res.href) {
    const tab = await chrome.tabs.get(t.tabId);
    // Only ever follow a link on the page's own site.
    if (new URL(res.href).origin !== new URL(tab.url!).origin) return { ok: false, detail: 'refused: link leaves the site' };
    await chrome.tabs.update(t.tabId, { url: res.href });
  }
  return { ok: res.ok, detail: res.detail, executedBy: 'dom' };
}

async function navStatus(t: Target | null, withItems: boolean): Promise<NavStatus | undefined> {
  if (!t) return undefined;
  const plan = await navPlanFor(t);
  if (!plan) return undefined;
  const res = await toFrame<NavReadResult>({ ...t, frameId: 0 }, { kind: 'navRead', plan, withItems }).catch(() => null);
  return res ?? undefined;
}

/**
 * Some sites keep the player behind a cover until a person clicks it, so there
 * is no <video> to drive. When the tab commands would go to (the focused one,
 * if no tab has a video) has a start plan for its page and the plan's control is
 * there, click it in the top frame, wait (bounded) for the video to appear in
 * any frame, and hand back that frame. Ad tabs the click opened are closed.
 */
async function ensurePlayer(t: Target | null): Promise<{ t: Target | null; note?: string; error?: string }> {
  const tab = t
    ? await chrome.tabs.get(t.tabId).catch(() => null)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id || !tab.url || !scriptable(tab)) return { t };
  const plan = startPlanFor(siteFor(tab.url)?.start, tab.url);
  // No plan, or the site's player is already the target.
  if (!plan || (t?.report.hasMedia && (!plan.player || isPlayerFrame(plan, t.report.url)))) return { t };

  const before = new Set((await frameReports(tab)).filter((f) => f.report.hasMedia).map((f) => f.frameId));
  const tabsBefore = new Set((await chrome.tabs.query({})).map((x) => x.id!));
  const click = (await chrome.tabs
    .sendMessage(tab.id, { relay: { kind: 'startPlayer', selector: plan.click } satisfies FrameAction }, { frameId: 0 })
    .catch((e: Error) => ({ ok: false, detail: e.message }))) as ActionResult;
  // No control. Without a player frame to tell them apart, whatever video is
  // there is the one to drive; with one, that video is not the site's player
  // (an ad, typically) and driving it is not what was asked.
  if (!click.ok) {
    if (t?.report.hasMedia && !plan.player) return { t };
    return { t, error: `${t?.report.hasMedia ? "The site's player is not on this page" : 'No tab with a video'}, and ${click.detail}` };
  }

  const waitMs = startWaitMs(plan);
  const deadline = Date.now() + waitMs;
  let found: Target | undefined;
  while (!found && Date.now() < deadline) {
    await sleep(250);
    const frames = (await frameReports(tab)).map((f) => ({ ...f, url: f.report.url, hasMedia: f.report.hasMedia }));
    found = startedFrames(plan, before, frames).sort((a, b) => b.report.area - a.report.area)[0];
  }

  // Ad popups: new tabs opened by this page while it was being started.
  const popups = popupTabs(tabsBefore, await chrome.tabs.query({}) as Array<{ id: number; openerTabId?: number }>, tab.id);
  let closed = '';
  if (popups.length > 0) {
    await chrome.tabs.remove(popups).catch(() => undefined);
    await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    closed = `, closed ${popups.length} popup tab${popups.length > 1 ? 's' : ''} it opened`;
  }
  if (!found) return { t, error: `clicked ${plan.click}${closed}, but no video appeared within ${Math.round(waitMs / 1000)} s` };
  return { t: found, note: `started the player (clicked ${plan.click}${closed})` };
}

async function execute(cmd: Command): Promise<ActionResult & { executedBy?: ExecutorId }> {
  let t = await pickTarget();
  let note: string | undefined;
  if (needsPlayer(cmd.op)) {
    const started = await ensurePlayer(t);
    if (started.error) return { ok: false, detail: started.error };
    ({ t, note } = started);
  }
  if (!t) return { ok: false, detail: 'No tab with a video' };
  const res = await run(cmd, t, !!note);
  return note ? { ...res, detail: res.detail ? `${note}; ${res.detail}` : note } : res;
}

async function run(cmd: Command, t: Target, started: boolean): Promise<ActionResult & { executedBy?: ExecutorId }> {
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
      // Starting the player is a request to watch: a toggle means play.
      const play = started ? (cmd.play ?? true) : cmd.play;
      const res = await toFrame<ActionResult>(t, { kind: 'playPause', play });
      return { ...res, executedBy: 'dom' };
    }
    case 'fullscreen.enter':
      return cmd.toggle && (await topFullscreen(t)) ? exitFullscreen(t) : enterFullscreen(t);
    case 'fullscreen.exit':
      return exitFullscreen(t);
    case 'nav.step':
      return navigate(t, (plan) => ({ kind: 'navStep', plan, delta: cmd.delta }));
    case 'nav.goto':
      return navigate(t, (plan) => ({ kind: 'navGoto', plan, index: cmd.index, label: cmd.label }));
    default:
      return { ok: false, detail: `unsupported operation: ${cmd.op}` };
  }
}

async function status(includeNavItems = false): Promise<DeviceStatus> {
  const t = await pickTarget();
  const nav = await navStatus(t, includeNavItems);
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
    fullscreen: t ? await topFullscreen(t) : null,
    ...(nav ? { nav } : {}),
  };
}

// ------------------------------------------------------------------ badge

/**
 * A green dot on the toolbar icon while a phone is connected, so the state is
 * visible without opening the popup; an amber "!" when not set up.
 */
function updateBadge(state: ReceiverState): void {
  const present = state.lastFrameAt !== null && Date.now() - state.lastFrameAt < PRESENCE_WINDOW_MS;
  if (!state.configured) {
    void chrome.action.setBadgeText({ text: '!' });
    void chrome.action.setBadgeBackgroundColor({ color: '#E8B04B' });
  } else if (present) {
    void chrome.action.setBadgeText({ text: '●' });
    void chrome.action.setBadgeBackgroundColor({ color: '#7FA88C' });
  } else {
    void chrome.action.setBadgeText({ text: '' });
  }
}

async function targetInfo(): Promise<TargetInfo | null> {
  const t = await pickTarget();
  if (!t) return null;
  const tab = await chrome.tabs.get(t.tabId).catch(() => null);
  return {
    title: tab?.title || t.report.title || t.report.url,
    url: tab?.url ?? t.report.url,
    favIconUrl: tab?.favIconUrl ?? null,
    hasMedia: t.report.hasMedia,
    playing: t.report.playing,
    positionMs: t.report.positionMs,
    durationMs: t.report.durationMs,
    fullscreen: await topFullscreen(t),
  };
}

// ---------------------------------------------------------------- updates

/**
 * Twice a day, ask GitHub for the latest release. An unpacked extension cannot
 * replace its own files, so this only tells the popup; the user unzips the new
 * version over the old folder and presses Reload there.
 */
async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const release = parseRelease(await res.json());
    const info: UpdateInfo = {
      version: release.version,
      pageUrl: release.pageUrl,
      zipUrl: release.assets.find((a) => /^relay-extension-.+\.zip$/.test(a.name))?.url ?? null,
      summary: releaseSummary(release.notes),
      important: release.important,
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ update: info });
    const newer = compareVersions(info.version, chrome.runtime.getManifest().version) > 0;
    void chrome.action.setTitle({ title: newer ? `Skipper — ${info.version} available` : 'Skipper' });
    return info;
  } catch {
    return null;
  }
}

// The store build has no alarms permission: the store updates it.
if (!isStoreInstall()) {
  chrome.alarms.create('update-check', { periodInMinutes: 12 * 60, delayInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'update-check') void checkForUpdate();
  });
}

// ----------------------------------------------------------------- wiring

let pushTimer: ReturnType<typeof setTimeout> | null = null;

chrome.runtime.onMessage.addListener((msg: RuntimeMessage | { mediaChanged?: true }, sender, respond) => {
  if (!('to' in msg)) {
    if (sender.tab?.id !== undefined) void chrome.storage.session.set({ lastMediaTabId: sender.tab.id });
    // Coalesce bursts (play + seeked + loadedmetadata) into one push.
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      await chrome.runtime
        .sendMessage({ to: 'offscreen', type: 'broadcastStatus', status: await status() } satisfies RuntimeMessage)
        .catch(() => undefined);
    }, 400);
    return false;
  }
  if (msg.to === 'any' && msg.type === 'state') {
    updateBadge(msg.state);
    return false;
  }
  if (msg.to !== 'worker') return false;
  if (msg.type === 'checkUpdate') {
    void checkForUpdate().then(respond);
    return true;
  }
  if (msg.type === 'getTarget') {
    void targetInfo().then(respond);
    return true;
  }
  if (msg.type === 'execute') {
    // A content script (the skip panel) may only ask for a jump. Fullscreen goes
    // through the debugger, and nothing a page's frame says should reach that.
    if (sender.tab && (msg.cmd as Command).op !== 'playback.seek') {
      respond({ ok: false, detail: 'not allowed from a page' });
      return false;
    }
    execute(msg.cmd as Command)
      .then(respond)
      .catch((e: Error) => respond({ ok: false, detail: e.message }));
    return true;
  }
  if (msg.type === 'status') {
    void status(msg.includeNavItems).then(respond);
    return true;
  }
  return false;
});
