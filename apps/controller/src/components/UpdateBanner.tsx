import { Platform, Text, View } from 'react-native';
import { useT } from '../lib/i18n';
import { canInstallInApp, openInstallPermissionSettings, startUpdate, useInstaller } from '../lib/updater';
import { currentVersion, type UpdateInfo, useNewerRelease, useUpdate } from '../state/update';
import { SmallButton } from './form';

/** A small amber dot: "there is an update", without shouting. */
export function UpdateDot({ className = '' }: { className?: string }) {
  return <View className={`h-2.5 w-2.5 rounded-full bg-primary ${className}`} />;
}

/** Label of the button that starts the update: download, install again, or the release notes. */
export function useUpdateActionLabel(info: UpdateInfo | null): string {
  const t = useT();
  const status = useInstaller((s) => s.status);
  const version = useInstaller((s) => s.version);
  if (!info) return '';
  if (!canInstallInApp(info)) return Platform.OS === 'ios' ? t('update.whatsNew') : t('update.releasePage');
  return status.kind === 'readyToInstall' && version === info.version ? t('update.install') : t('update.download');
}

/**
 * Download progress, the checksum or install error, and the unknown-sources
 * hand-off. Renders nothing until a download for `version` has started.
 */
export function InstallProgress({ version }: { version: string }) {
  const t = useT();
  const { status, installBlocked, version: installing } = useInstaller();
  if (status.kind === 'idle' || installing !== version) return null;

  return (
    <View className="gap-2">
      {status.kind === 'downloading' ? (
        <View className="gap-1.5">
          <View className="h-2 overflow-hidden rounded-full bg-secondary">
            <View className="h-2 rounded-full bg-primary" style={{ width: `${Math.round(status.progress * 100)}%` }} />
          </View>
          <Text className="text-xs text-muted-foreground">
            {t('update.downloading', { percent: Math.round(status.progress * 100) })}
          </Text>
        </View>
      ) : null}
      {status.kind === 'failed' ? <Text className="text-sm text-destructive">{status.message}</Text> : null}
      {status.kind === 'readyToInstall' && !installBlocked ? (
        <Text className="text-sm text-muted-foreground">{t('update.readyHint')}</Text>
      ) : null}
      {installBlocked ? (
        <>
          <Text className="text-sm leading-5 text-muted-foreground">{t('update.blockedHint')}</Text>
          <SmallButton label={t('update.openSettings')} onPress={() => void openInstallPermissionSettings()} />
        </>
      ) : null}
    </View>
  );
}

/** On top of the remote while a newer release exists and wasn't put off. */
export function UpdateBanner() {
  const t = useT();
  const snooze = useUpdate((s) => s.snooze);
  const snoozeLatest = useUpdate((s) => s.snoozeLatest);
  const downloading = useInstaller((s) => s.status.kind === 'downloading');
  const info = useNewerRelease();
  const actionLabel = useUpdateActionLabel(info);
  if (!info) return null;
  if (snooze && snooze.version === info.version && Date.now() < snooze.until) return null;

  return (
    <View className={`gap-3 rounded-2xl border bg-card p-4 ${info.important ? 'border-primary' : 'border-border'}`}>
      <View className="gap-1">
        <Text className="text-base font-bold text-foreground">
          {info.important
            ? t('update.importantTitle', { version: info.version })
            : t('update.availableTitle', { version: info.version })}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t('update.youHave', { version: currentVersion() })}{' '}
          {Platform.OS === 'ios' ? t('update.howIos') : t('update.howAndroid')}
        </Text>
      </View>
      {info.summary.map((line) => (
        <Text key={line} className="text-sm leading-5 text-muted-foreground">
          • {line}
        </Text>
      ))}
      <InstallProgress version={info.version} />
      <View className="flex-row gap-2">
        <View className="flex-1">
          <SmallButton label={actionLabel} tone="primary" disabled={downloading} onPress={() => startUpdate(info)} />
        </View>
        <SmallButton label={t('update.later')} onPress={snoozeLatest} />
      </View>
    </View>
  );
}
