/**
 * Starting a player that a page keeps behind a cover, as data plus a little
 * pure logic.
 *
 * Some sites show only a poster until a person clicks it; the <video> (often in
 * an iframe) exists only afterwards, so there is nothing to play, seek or put
 * in fullscreen. A site's plan lives in sites.json under "start" and names the
 * control to click. Nothing here knows about any particular site.
 */

import { planApplies } from './nav';

export interface StartPlan {
  /** Regex on the page's path; the plan applies only where it matches. Default: everywhere on the site. */
  paths?: string;
  /** CSS selector, in the top frame, of the control that starts the player. Present only while it is not started. */
  click: string;
  /**
   * Regex on the URL of the frame that plays the video once started. Such a
   * frame is preferred over any other video in the tab: ad banners on the same
   * page play videos of their own.
   */
  player?: string;
  /** How long to wait for the video after the click, ms. Default 6000. */
  waitMs?: number;
}

export const DEFAULT_START_WAIT_MS = 6000;
/** Never wait longer than this, whatever a plan says. */
const MAX_START_WAIT_MS = 15_000;

export const startWaitMs = (plan: StartPlan): number =>
  Math.min(Math.max(plan.waitMs ?? DEFAULT_START_WAIT_MS, 0), MAX_START_WAIT_MS);

/** The plan for a page, if it has one that applies to the page's path. */
export function startPlanFor(plan: StartPlan | undefined, pageUrl: string): StartPlan | null {
  if (!plan?.click) return null;
  try {
    return planApplies(plan, new URL(pageUrl).pathname) ? plan : null;
  } catch {
    return null;
  }
}

/** Commands that need a player: these may start one. Navigation, status and leaving fullscreen never do. */
export const needsPlayer = (op: string): boolean =>
  op === 'playback.playPause' || op === 'playback.seek' || op === 'playback.seekTo' || op === 'fullscreen.enter';

/** Whether a frame is the site's own player, by its URL. */
export function isPlayerFrame(plan: StartPlan | null | undefined, frameUrl: string): boolean {
  if (!plan?.player) return false;
  try {
    return new RegExp(plan.player).test(frameUrl);
  } catch {
    return false;
  }
}

export interface FrameMedia {
  frameId: number;
  url: string;
  hasMedia: boolean;
}

/**
 * The frames that show the started player: with media, and either the plan's
 * player frame or one that had no media before the click (so an ad that was
 * already playing does not count as the player having appeared).
 */
export function startedFrames<T extends FrameMedia>(plan: StartPlan, before: ReadonlySet<number>, after: T[]): T[] {
  const media = after.filter((f) => f.hasMedia);
  const players = media.filter((f) => isPlayerFrame(plan, f.url));
  return players.length > 0 ? players : media.filter((f) => !before.has(f.frameId));
}

export interface TabInfo {
  id: number;
  openerTabId?: number;
}

/** Tabs that appeared while the player was being started and were opened by its page: ad popups. */
export function popupTabs(beforeIds: ReadonlySet<number>, after: TabInfo[], pageTabId: number): number[] {
  return after.filter((t) => !beforeIds.has(t.id) && t.openerTabId === pageTabId).map((t) => t.id);
}
