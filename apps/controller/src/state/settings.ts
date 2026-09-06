import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted controller settings. `seekPresets` is the customisable jump list
 * from the brief — the controller owns these values and ships them inside each
 * command, so changing them never requires touching the receiver.
 */
export interface Settings {
  pairCode: string;
  lanHost: string | null;
  relayUrl: string | null;
  bleDeviceId: string | null;
  /** Seconds. Rendered as one button each on the dashboard. */
  seekPresets: number[];
  /** Mirror commands across two transports. Costs a duplicate frame, buys reliability. */
  mirrorCritical: boolean;
  hapticFeedback: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  pairCode: '',
  lanHost: null,
  relayUrl: null,
  bleDeviceId: null,
  seekPresets: [10, 30, 90],
  mirrorCritical: true,
  hapticFeedback: true,
};

const KEY = 'relay.settings.v1';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
