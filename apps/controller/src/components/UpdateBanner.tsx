import * as Linking from 'expo-linking';
import { Platform, Text, View } from 'react-native';
import { currentVersion, newerRelease, type UpdateInfo, useUpdate } from '../state/update';
import { SmallButton } from './form';

/** Opens the APK on Android (the system installer takes it from there), the release page otherwise. */
export function openUpdate(info: UpdateInfo): void {
  void Linking.openURL(Platform.OS === 'android' && info.apkUrl ? info.apkUrl : info.pageUrl);
}

/** On top of the remote while a newer release exists and wasn't put off. */
export function UpdateBanner() {
  const latest = useUpdate((s) => s.latest);
  const snooze = useUpdate((s) => s.snooze);
  const snoozeLatest = useUpdate((s) => s.snoozeLatest);
  const info = newerRelease(latest);
  if (!info) return null;
  if (snooze && snooze.version === info.version && Date.now() < snooze.until) return null;

  return (
    <View className={`gap-3 rounded-2xl border bg-card p-4 ${info.important ? 'border-primary' : 'border-border'}`}>
      <View className="gap-1">
        <Text className="text-base font-bold text-foreground">
          {info.important ? `Aggiornamento importante: Skipper ${info.version}` : `Skipper ${info.version} è disponibile`}
        </Text>
        <Text className="text-sm text-muted-foreground">
          Hai la {currentVersion()}.{' '}
          {Platform.OS === 'ios' ? 'Aggiornala da AltStore.' : 'Scarica il nuovo APK e installalo sopra: associazioni e impostazioni restano.'}
        </Text>
      </View>
      {info.summary.map((line) => (
        <Text key={line} className="text-sm leading-5 text-muted-foreground">
          • {line}
        </Text>
      ))}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <SmallButton
            label={Platform.OS === 'ios' ? 'Novità' : 'Scarica'}
            tone="primary"
            onPress={() => openUpdate(info)}
          />
        </View>
        <SmallButton label="Più tardi" onPress={snoozeLatest} />
      </View>
    </View>
  );
}
