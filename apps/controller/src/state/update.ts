import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  compareVersions,
  LATEST_RELEASE_API,
  parseRelease,
  releaseSummary,
} from '@relay/protocol';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** The version this build was made from; the release tag in CI. */
export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** How often the app asks GitHub on its own; "Controlla ora" ignores it. */
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  pageUrl: string;
  /** The Android APK of the remote, when the release has one. */
  apkUrl: string | null;
  summary: string[];
  important: boolean;
}

interface UpdateState {
  latest: UpdateInfo | null;
  checkedAt: number | null;
  checking: boolean;
  failed: boolean;
  snooze: { version: string; until: number } | null;
  check: (force?: boolean) => Promise<void>;
  snoozeLatest: () => void;
}

/**
 * Update notices for the remote, from the latest GitHub release. Recommended,
 * never forced: Android installs the new APK over the old one, iOS gets it
 * through AltStore.
 */
export const useUpdate = create<UpdateState>()(
  persist(
    (set, get) => ({
      latest: null,
      checkedAt: null,
      checking: false,
      failed: false,
      snooze: null,
      check: async (force = false) => {
        const { checking, checkedAt } = get();
        if (checking) return;
        if (!force && checkedAt && Date.now() - checkedAt < CHECK_EVERY_MS) return;
        set({ checking: true, failed: false });
        try {
          const res = await fetch(LATEST_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const release = parseRelease(await res.json());
          set({
            latest: {
              version: release.version,
              pageUrl: release.pageUrl,
              apkUrl: release.assets.find((a) => /^relay-controller-.+\.apk$/.test(a.name))?.url ?? null,
              summary: releaseSummary(release.notes, 3),
              important: release.important,
            },
            checkedAt: Date.now(),
            checking: false,
          });
        } catch {
          set({ checking: false, failed: true });
        }
      },
      snoozeLatest: () => {
        const latest = get().latest;
        if (latest) set({ snooze: { version: latest.version, until: Date.now() + SNOOZE_MS } });
      },
    }),
    {
      name: 'skipper-update',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ latest, checkedAt, snooze }) => ({ latest, checkedAt, snooze }),
    },
  ),
);

/** The newer release, if there is one; null when up to date or not checked yet. */
export function newerRelease(latest: UpdateInfo | null): UpdateInfo | null {
  return latest && compareVersions(latest.version, currentVersion()) > 0 ? latest : null;
}
