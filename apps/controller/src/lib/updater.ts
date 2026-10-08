import { checksumFor } from '@relay/protocol';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { UpdateInfo } from '../state/update';
import { t } from './i18n';

/**
 * Installs an update the checker in state/update.ts has found. On Android it
 * downloads `relay-controller-<v>.apk` into the app's cache, verifies it
 * against the release's SHA256SUMS.txt and hands it to the system installer,
 * which updates in place (every release is signed with the same key; Android
 * refuses anything else). Elsewhere it opens the release page.
 *
 * Nothing is ever downloaded or installed without the user pressing the button.
 */

const inAppInstall = Platform.OS === 'android';

const APK_MIME = 'application/vnd.android.package-archive';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION: lets the installer read our content:// URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
/** Activity.RESULT_OK */
const RESULT_OK = -1;

export type InstallStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'readyToInstall' }
  | { kind: 'failed'; message: string };

interface InstallerStore {
  status: InstallStatus;
  /** The version the status refers to. */
  version: string | null;
  /** The installer came back without installing: probably "unknown sources" is off. */
  installBlocked: boolean;
}

export const useInstaller = create<InstallerStore>()(() => ({
  status: { kind: 'idle' },
  version: null,
  installBlocked: false,
}));

const setStatus = (status: InstallStatus) => useInstaller.setState({ status });

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const updatesDir = () => new Directory(Paths.cache, 'updates');

/** Whether this platform and release can be installed from inside the app. */
export const canInstallInApp = (info: UpdateInfo): boolean => inAppInstall && info.apk !== null;

/**
 * What the banner's main button does: download and install on Android (or
 * reopen the installer once downloaded), the release page anywhere else.
 */
export function startUpdate(info: UpdateInfo): void {
  if (!canInstallInApp(info)) {
    void Linking.openURL(info.pageUrl);
    return;
  }
  const { status, version } = useInstaller.getState();
  if (status.kind === 'downloading') return;
  if (status.kind === 'readyToInstall' && version === info.version) void installDownloaded(info);
  else void downloadAndInstall(info);
}

/** SHA-256 of the file in lowercase hex, computed natively. */
async function sha256OfFile(file: File): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downloads the APK, verifies it against SHA256SUMS.txt when the release has one, then installs. */
async function downloadAndInstall(info: UpdateInfo): Promise<void> {
  const apk = info.apk;
  if (!apk) return;
  const dir = updatesDir();
  try {
    useInstaller.setState({ status: { kind: 'downloading', progress: 0 }, version: info.version, installBlocked: false });
    // Previous downloads are dead weight; start from an empty directory.
    if (dir.exists) dir.delete();
    dir.create({ idempotent: true });
    const file = new File(dir, apk.name);

    let lastPercent = -1;
    await File.downloadFileAsync(apk.url, file, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : apk.size;
        const percent = total > 0 ? Math.min(100, Math.floor((bytesWritten / total) * 100)) : 0;
        if (percent === lastPercent) return;
        lastPercent = percent;
        setStatus({ kind: 'downloading', progress: percent / 100 });
      },
    });

    if (info.sumsUrl) {
      const res = await fetch(info.sumsUrl);
      if (!res.ok) throw new Error(`SHA256SUMS.txt: ${res.status}`);
      const expected = checksumFor(await res.text(), apk.name);
      if (!expected) throw new Error(t('update.noChecksum'));
      if ((await sha256OfFile(file)) !== expected) throw new Error(t('update.badChecksum'));
    }

    setStatus({ kind: 'readyToInstall' });
    await installDownloaded(info);
  } catch (e) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // Cache cleanup is best effort.
    }
    setStatus({ kind: 'failed', message: t('update.downloadFailed', { reason: errorMessage(e) }) });
  }
}

/** Opens the system installer on the downloaded APK (also the retry after the unknown-sources detour). */
async function installDownloaded(info: UpdateInfo): Promise<void> {
  if (!info.apk) return;
  const file = new File(updatesDir(), info.apk.name);
  if (!file.exists) {
    setStatus({ kind: 'failed', message: t('update.downloadFailed', { reason: 'file missing' }) });
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
    useInstaller.setState({ status: { kind: 'readyToInstall' }, installBlocked: result.resultCode !== RESULT_OK });
  } catch (e) {
    setStatus({ kind: 'failed', message: t('update.installFailed', { reason: errorMessage(e) }) });
  }
}

/** Opens the system page where the user allows this app to install packages. */
export async function openInstallPermissionSettings(): Promise<void> {
  if (!inAppInstall) return;
  try {
    await startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: `package:${Application.applicationId ?? 'dev.sandoramix.skipper'}`,
    });
  } catch (e) {
    setStatus({ kind: 'failed', message: t('update.installFailed', { reason: errorMessage(e) }) });
  }
}
