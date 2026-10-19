import type { PanelSettings } from '../panel';

/**
 * What a style is. The core (overlay.ts) owns the settings, the keys, the
 * pointer, the fullscreen re-parenting and the one-time tip; a style only
 * draws and reacts: its markup and CSS go in the shared Shadow DOM, and the
 * core calls the view with where the video is and what just happened.
 */

/** The part of the video that is on screen, in viewport pixels. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A jump that went through, with what a style needs to show it. */
export interface Jumped {
  dir: 1 | -1;
  /** This jump, in seconds. */
  seconds: number;
  /** The running total of quick jumps in this direction, in seconds. */
  total: number;
  /** This jump started a new run rather than adding to one. */
  fresh: boolean;
  /** Playback position before and after, ms; null when the video is not in this frame. */
  from: number | null;
  to: number | null;
  duration: number | null;
}

/** What the core lets a style do. */
export interface Ctx {
  root: ShadowRoot;
  settings(): PanelSettings;
  /** Skip back or forward by the selected amount. */
  jump(dir: 1 | -1): void;
  /** Select an amount, in seconds. */
  pick(seconds: number): void;
  /** Select the next or previous preset. */
  step(dir: 1 | -1): void;
  /** The pointer is on a control: keep it showing. */
  hold(on: boolean): void;
}

export interface StyleView {
  place(r: Rect): void;
  show(): void;
  hide(): void;
  render(p: PanelSettings): void;
  /** The key or button was pressed; the answer is not back yet. */
  press?(dir: 1 | -1): void;
  jumped(e: Jumped): void;
  /** Alt went down or up over the video: a style without buttons shows how it works. */
  guide?(on: boolean, pos: { ms: number | null; duration: number | null }): void;
  /** Where the first-use tip goes; the bottom centre of the video otherwise. */
  tipAt?(r: Rect): { x: number; y: number; align: 'start' | 'center' | 'end' };
}

export interface StyleDef {
  /** Pointer movement over the video wakes it (pills, dock); the others wait for a jump or Alt. */
  wakes: boolean;
  /** Alt + scroll over the video skips. */
  altWheel: boolean;
  css: string;
  html: string;
  create(ctx: Ctx): StyleView;
}

export const EDGE = 14;
export const PILL_HEIGHT = 48;

export const GLASS = `background: rgba(18, 22, 28, .72); border: 1px solid rgba(255, 255, 255, .14);
  -webkit-backdrop-filter: blur(12px) saturate(1.5); backdrop-filter: blur(12px) saturate(1.5);
  box-shadow: 0 6px 24px rgba(0, 0, 0, .35);`;

export const ICON_BACK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
export const ICON_FWD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';

/** Plays a CSS animation again from the start. */
export function restart(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export const signed = (dir: 1 | -1, text: string): string => `${dir < 0 ? '−' : '+'}${text}`;
