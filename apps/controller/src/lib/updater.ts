import {
  checksumFor,
  compareVersions,
  CONTROLLER_APK_PATTERN,
  findAsset,
  isCheckDue,
  LATEST_RELEASE_API,
  parseRelease,
  releaseSummary,
  type LatestRelease,
  type ReleaseAsset,
} from '@relay/protocol';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { useSettings } from '../state/settings';
import { t } from './i18n';

/**
 * In-app updates for the Android controller. It asks GitHub for the latest
 * release, downloads `relay-controller-<v>.apk` into the app's cache and hands
 * it to the system installer, which updates in place (every release is signed
 * with the same key; Android refuses anything else). iOS and web: all no-ops.
 *
 * Nothing is ever downloaded or installed without the user pressing the button.
 */

export const updatesSupported = Platform.OS === 'android';

const CHECK_INTERVAL_MS = 12 * 3_600_000;
const CHECK_TIMEOUT_MS = 15_000;
const SUMS_NAME = 'SHA256SUMS.txt';
const APK_MIME = 'application/vnd.android.package-archive';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION: lets the installer read our content:// URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
/** Activity.RESULT_OK */
const RESULT_OK = -1;

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'readyToInstall' }
  | { kind: 'failed'; message: string };

export interface UpdateInfo {
  release: LatestRelease;
  summary: string[];
  apk: ReleaseAsset;
  sums: ReleaseAsset | null;
}

interface UpdaterStore {
  status: UpdateStatus;
  /** The newer release, once a check has found one. */
  update: UpdateInfo | null;
  /** The installer came back without installing: probably "unknown sources" is off. */
  installBlocked: boolean;
}

export const useUpdater = create<UpdaterStore>()(() => ({
  status: { kind: 'idle' },
  update: null,
  installBlocked: false,
}));

const setStatus = (status: UpdateStatus) => useUpdater.setState({ status });

/** The version this build was released as (the tag, via `RELAY_VERSION` in app.config.ts). */
export const installedVersion = (): string => Application.nativeApplicationVersion ?? '0.0.0';

/** True when a check has seen a release newer than this build. Drives the badges. */
export function useUpdateAvailable(): boolean {
  const known = useSettings((s) => s.knownUpdateVersion);
  return updatesSupported && known !== null && compareVersions(known, installedVersion()) > 0;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Asks GitHub for the latest release. `silent` is the startup check: it
 * honours the 12 h throttle and never surfaces an error.
 */
export async function checkForUpdate({ silent = false }: { silent?: boolean } = {}): Promise<void> {
  if (!updatesSupported) return;
  const { status } = useUpdater.getState();
  if (status.kind === 'checking' || status.kind === 'downloading') return;
  const settings = useSettings.getState();
  if (silent && !isCheckDue(settings.lastUpdateCheck, Date.now(), CHECK_INTERVAL_MS)) return;

  if (!silent) setStatus({ kind: 'checking' });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: timeout.signal,
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const release = parseRelease(await res.json());
    const apk = findAsset(release.assets, CONTROLLER_APK_PATTERN);
    const newer = compareVersions(release.version, installedVersion()) > 0 && apk !== null;
    settings.set({ lastUpdateCheck: Date.now(), knownUpdateVersion: newer ? release.version : null });
    if (newer && apk) {
      useUpdater.setState({
        update: {
          release,
          summary: releaseSummary(release.notes),
          apk,
          sums: findAsset(release.assets, new RegExp(`^${SUMS_NAME}$`)),
        },
        status: { kind: 'available' },
        installBlocked: false,
      });
    } else {
      useUpdater.setState({ update: null, status: silent ? { kind: 'idle' } : { kind: 'upToDate' } });
    }
  } catch (e) {
    if (silent) setStatus({ kind: 'idle' });
    else setStatus({ kind: 'failed', message: t('updates.checkFailed', { reason: errorMessage(e) }) });
  } finally {
    clearTimeout(timer);
  }
}

/** SHA-256 of the file in lowercase hex, computed natively. */
async function sha256OfFile(file: File): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downloads the APK, verifies it against SHA256SUMS.txt when the release has one, then installs. */
export async function downloadAndInstall(): Promise<void> {
  if (!updatesSupported) return;
  const { update, status } = useUpdater.getState();
  if (!update || status.kind === 'downloading') return;

  const dir = new Directory(Paths.cache, 'updates');
  try {
    setStatus({ kind: 'downloading', progress: 0 });
    // Previous downloads are dead weight; start from an empty directory.
    if (dir.exists) dir.delete();
    dir.create({ idempotent: true });
    const file = new File(dir, update.apk.name);

    let lastPercent = -1;
    await File.downloadFileAsync(update.apk.url, file, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : update.apk.size;
        const percent = total > 0 ? Math.min(100, Math.floor((bytesWritten / total) * 100)) : 0;
        if (percent === lastPercent) return;
        lastPercent = percent;
        setStatus({ kind: 'downloading', progress: percent / 100 });
      },
    });

    if (update.sums) {
      const res = await fetch(update.sums.url);
      if (!res.ok) throw new Error(`${SUMS_NAME}: ${res.status}`);
      const expected = checksumFor(await res.text(), update.apk.name);
      if (!expected) throw new Error(t('updates.noChecksum'));
      if ((await sha256OfFile(file)) !== expected) throw new Error(t('updates.badChecksum'));
    }

    setStatus({ kind: 'readyToInstall' });
    await installDownloaded();
  } catch (e) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // Cache cleanup is best effort.
    }
    setStatus({ kind: 'failed', message: t('updates.downloadFailed', { reason: errorMessage(e) }) });
  }
}

/** Opens the system installer on the downloaded APK (also the retry after the unknown-sources detour). */
export async function installDownloaded(): Promise<void> {
  if (!updatesSupported) return;
  const { update } = useUpdater.getState();
  if (!update) return;
  const file = new File(new Directory(Paths.cache, 'updates'), update.apk.name);
  if (!file.exists) {
    setStatus({ kind: 'failed', message: t('updates.downloadFailed', { reason: 'file missing' }) });
    return;
  }
  try {
    const result = await startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    // A successful in-place update restarts the app, so getting here at all
    // usually means the install didn't happen: cancelled, or blocked because
    // this app may not install packages yet.
    useUpdater.setState({ installBlocked: result.resultCode !== RESULT_OK });
    setStatus({ kind: 'readyToInstall' });
  } catch (e) {
    setStatus({ kind: 'failed', message: t('updates.installFailed', { reason: errorMessage(e) }) });
  }
}

/** Opens the system page where the user allows this app to install packages. */
export async function openInstallPermissionSettings(): Promise<void> {
  if (!updatesSupported) return;
  try {
    await startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: `package:${Application.applicationId ?? 'com.relay.controller'}`,
    });
  } catch (e) {
    setStatus({ kind: 'failed', message: t('updates.installFailed', { reason: errorMessage(e) }) });
  }
}
