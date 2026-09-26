import type { DeviceStatus } from '@relay/protocol';
import { DEFAULT_MQTT_URL } from '@relay/protocol';

/**
 * Messages between the three extension contexts. The offscreen document owns
 * the network, the service worker owns the tabs, the content script owns one
 * frame's <video>. None of them can do the others' job:
 *  - service workers have no RTCPeerConnection
 *  - offscreen documents cannot touch tabs, scripting or the debugger
 *  - content scripts only see their own frame
 */

export type BrowserTransportId = 'webrtc' | 'relay' | 'http' | 'mqtt';

export interface ExtensionSettings {
  pairCode: string;
  relayUrl: string;
  mqttUrl: string;
  disabled: BrowserTransportId[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  pairCode: '',
  relayUrl: '',
  mqttUrl: DEFAULT_MQTT_URL,
  disabled: [],
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = (await chrome.storage.local.get('settings')) as { settings?: Partial<ExtensionSettings> };
  return { ...DEFAULT_SETTINGS, ...stored.settings };
}

/** What a content script reports about the media in its frame. */
export interface MediaReport {
  hasMedia: boolean;
  playing: boolean;
  positionMs: number | null;
  durationMs: number | null;
  title: string | null;
  fullscreen: boolean;
  /** Visible area of the main video, to pick the most prominent one. */
  area: number;
  url: string;
}

/** An action the service worker asks a content script to perform. */
export type FrameAction =
  | { kind: 'report' }
  | { kind: 'seek'; deltaMs: number }
  | { kind: 'seekTo'; positionMs: number }
  | { kind: 'playPause'; play?: boolean }
  | { kind: 'exitFullscreen' };

export interface ActionResult {
  ok: boolean;
  detail?: string;
}

export interface PathState {
  id: BrowserTransportId;
  /** Connected to its rendezvous (relay, broker) or, for WebRTC, the channel is open. */
  up: boolean;
  /** Last signed frame from the phone on this path, epoch ms. */
  lastFrameAt: number | null;
}

/** A phone counts as connected while its signed frames keep arriving. */
export const PRESENCE_WINDOW_MS = 12_000;

export interface LastCommand {
  op: string;
  /** The command's arguments, localized by the popup. */
  args: { deltaMs?: number; positionMs?: number; play?: boolean; toggle?: boolean };
  ok: boolean;
  detail?: string;
  at: number;
  path: BrowserTransportId;
}

/** Result of the last update check, kept in chrome.storage.local under "update". */
export interface UpdateInfo {
  version: string;
  pageUrl: string;
  zipUrl: string | null;
  summary: string[];
  important: boolean;
  checkedAt: number;
}

/** Everything the popup shows, from the offscreen document. */
export interface ReceiverState {
  configured: boolean;
  paths: PathState[];
  /** Last signed frame from the phone on any path. */
  lastFrameAt: number | null;
  lastPath: BrowserTransportId | null;
  lastCommand: LastCommand | null;
}

/** The tab commands would go to right now, from the service worker. */
export interface TargetInfo {
  title: string;
  url: string;
  favIconUrl: string | null;
  hasMedia: boolean;
  playing: boolean;
  positionMs: number | null;
  durationMs: number | null;
  fullscreen: boolean;
}

export type RuntimeMessage =
  // offscreen → worker: execute this verified command
  | { to: 'worker'; type: 'execute'; cmd: unknown }
  // offscreen → worker: build a status snapshot
  | { to: 'worker'; type: 'status' }
  // offscreen → worker/popup: something the popup shows changed
  | { to: 'any'; type: 'state'; state: ReceiverState }
  // popup → worker: the tab commands would go to
  | { to: 'worker'; type: 'getTarget' }
  // popup → worker: check GitHub for a newer release now
  | { to: 'worker'; type: 'checkUpdate' }
  // worker → offscreen: (re)start with these settings
  | { to: 'offscreen'; type: 'configure'; settings: ExtensionSettings }
  // popup → offscreen: current receiver state
  | { to: 'offscreen'; type: 'getState' }
  // worker → offscreen: push an unsolicited status event
  | { to: 'offscreen'; type: 'broadcastStatus'; status: DeviceStatus };
