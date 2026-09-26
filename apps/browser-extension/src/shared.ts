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
  up: boolean;
}

export type RuntimeMessage =
  // offscreen → worker: execute this verified command
  | { to: 'worker'; type: 'execute'; cmd: unknown }
  // offscreen → worker: build a status snapshot
  | { to: 'worker'; type: 'status' }
  // offscreen → worker/popup: path health changed
  | { to: 'any'; type: 'paths'; paths: PathState[] }
  // worker → offscreen: (re)start with these settings
  | { to: 'offscreen'; type: 'configure'; settings: ExtensionSettings }
  // popup → offscreen: current path health
  | { to: 'offscreen'; type: 'getPaths' }
  // worker → offscreen: push an unsolicited status event
  | { to: 'offscreen'; type: 'broadcastStatus'; status: DeviceStatus };
