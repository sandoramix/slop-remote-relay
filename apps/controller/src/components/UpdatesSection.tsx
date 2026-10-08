import { Linking, Text, View } from 'react-native';
import { Divider, Section, SmallButton } from './form';
import { useT } from '../lib/i18n';
import {
  checkForUpdate,
  downloadAndInstall,
  installDownloaded,
  installedVersion,
  openInstallPermissionSettings,
  updatesSupported,
  useUpdateAvailable,
  useUpdater,
} from '../lib/updater';

/** A small amber dot: "there is an update", without shouting. */
export function UpdateDot({ className = '' }: { className?: string }) {
  return <View className={`h-2.5 w-2.5 rounded-full bg-primary ${className}`} />;
}

/** The Updates block of the settings screen. Renders nothing off Android. */
export function UpdatesSection() {
  const t = useT();
  const { status, update, installBlocked } = useUpdater();
  const hasUpdate = useUpdateAvailable();
  if (!updatesSupported) return null;

  const busy = status.kind === 'checking' || status.kind === 'downloading';
  const downloaded = status.kind === 'readyToInstall';

  return (
    <Section title={t('updates.title')}>
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <Text className="flex-1 text-base text-foreground">{t('updates.current')}</Text>
        {hasUpdate ? <UpdateDot /> : null}
        <Text className="text-sm text-muted-foreground">{installedVersion()}</Text>
      </View>
      <Divider />

      {update ? (
        <View className="gap-2 px-4 py-3.5">
          <Text className="text-base font-semibold text-foreground">
            {t('updates.available', { version: update.release.version })}
          </Text>
          {update.summary.map((line) => (
            <Text key={line} className="text-sm leading-5 text-muted-foreground">
              {`• ${line}`}
            </Text>
          ))}
          <Text
            className="text-sm text-primary"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(update.release.pageUrl)}
          >
            {t('updates.releasePage')}
          </Text>
        </View>
      ) : null}

      <View className="gap-3 px-4 py-3">
        {status.kind === 'downloading' ? (
          <View className="gap-1.5">
            <View className="h-2 overflow-hidden rounded-full bg-secondary">
              <View className="h-2 rounded-full bg-primary" style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </View>
            <Text className="text-xs text-muted-foreground">
              {t('updates.downloading', { percent: Math.round(status.progress * 100) })}
            </Text>
          </View>
        ) : null}

        {status.kind === 'upToDate' ? (
          <Text className="text-sm text-muted-foreground">{t('updates.upToDate')}</Text>
        ) : null}
        {status.kind === 'failed' ? <Text className="text-sm text-destructive">{status.message}</Text> : null}
        {downloaded && !installBlocked ? (
          <Text className="text-sm text-muted-foreground">{t('updates.readyHint')}</Text>
        ) : null}
        {installBlocked ? <Text className="text-sm leading-5 text-muted-foreground">{t('updates.blockedHint')}</Text> : null}

        {installBlocked ? (
          <SmallButton label={t('updates.openSettings')} onPress={() => void openInstallPermissionSettings()} />
        ) : null}

        {update && !busy ? (
          downloaded ? (
            <SmallButton tone="primary" label={t('updates.install')} onPress={() => void installDownloaded()} />
          ) : (
            <SmallButton tone="primary" label={t('updates.download')} onPress={() => void downloadAndInstall()} />
          )
        ) : null}

        <SmallButton
          label={status.kind === 'checking' ? t('updates.checking') : t('updates.check')}
          disabled={busy}
          onPress={() => void checkForUpdate()}
        />
      </View>
    </Section>
  );
}
