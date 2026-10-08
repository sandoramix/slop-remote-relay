import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  compareVersions,
  CONTROLLER_APK_PATTERN,
  findAsset,
  isCheckDue,
  LATEST_RELEASE_API,
  parseRelease,
  releaseSummary,
  type ReleaseAsset,
} from '@relay/protocol';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** The version this build was made from; the release tag in CI. */
export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** How often the app asks GitHub on its own; "Check now" ignores it. */
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15_000;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SUMS_PATTERN = /^SHA256SUMS\.txt$/;

export interface UpdateInfo {
  version: string;
  pageUrl: string;
  /** The Android APK of the remote, when the release has one. */
  apk: ReleaseAsset | null;
  /** SHA256SUMS.txt of the release, to verify the APK before installing it. */
  sumsUrl: string | null;
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
 * Update notices for the remote, from the latest GitHub release: the only
 * update checker in the app. Recommended, never forced: on Android the banner
 * downloads and installs the new APK over the old one (lib/updater.ts), iOS
 * gets it through AltStore.
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
        if (!force && !isCheckDue(checkedAt ?? 0, Date.now(), CHECK_EVERY_MS)) return;
        set({ checking: true, failed: false });
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), CHECK_TIMEOUT_MS);
        try {
          const res = await fetch(LATEST_RELEASE_API, {
            headers: { accept: 'application/vnd.github+json' },
            signal: timeout.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const release = parseRelease(await res.json());
          set({
            latest: {
              version: release.version,
              pageUrl: release.pageUrl,
              apk: findAsset(release.assets, CONTROLLER_APK_PATTERN),
              sumsUrl: findAsset(release.assets, SUMS_PATTERN)?.url ?? null,
              summary: releaseSummary(release.notes, 3),
              important: release.important,
            },
            checkedAt: Date.now(),
            checking: false,
          });
        } catch {
          set({ checking: false, failed: true });
        } finally {
          clearTimeout(timer);
        }
      },
      snoozeLatest: () => {
        const latest = get().latest;
        if (latest) set({ snooze: { version: latest.version, until: Date.now() + SNOOZE_MS } });
      },
    }),
    {
      name: 'skipper-update',
      // v1: UpdateInfo carries the APK asset (name, size) and the checksums URL
      // instead of a bare apkUrl. Older entries are dropped and fetched again.
      version: 1,
      migrate: () => ({ latest: null, checkedAt: null, snooze: null }) as unknown as UpdateState,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ latest, checkedAt, snooze }) => ({ latest, checkedAt, snooze }),
    },
  ),
);

/** The newer release, if there is one; null when up to date or not checked yet. */
export function newerRelease(latest: UpdateInfo | null): UpdateInfo | null {
  return latest && compareVersions(latest.version, currentVersion()) > 0 ? latest : null;
}

/** The newer release, for components. */
export function useNewerRelease(): UpdateInfo | null {
  return newerRelease(useUpdate((s) => s.latest));
}
