import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { DeviceForm, emptyTarget } from '../components/DeviceForm';
import { Field, PrimaryButton, Section } from '../components/form';
import { useT } from '../lib/i18n';
import { TargetSchema, useSettings } from '../state/settings';

/**
 * First run: pair one device. Kept to a single screen — a code, a name, and
 * optionally a relay — because the receiver shows the same code and there is
 * nothing else to configure before the remote is useful.
 */
export default function Onboarding() {
  const t = useT();
  const [target, setTarget] = useState(() => emptyTarget());
  const relayUrl = useSettings((s) => s.relayUrl);
  const [relay, setRelay] = useState(relayUrl ?? '');
  const upsert = useSettings((s) => s.upsertTarget);
  const set = useSettings((s) => s.set);
  const valid = TargetSchema.safeParse(target).success;
  const needsRelay = target.kind === 'browser' && !relay.trim();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardSafe>
        <ScrollView contentContainerClassName="gap-8 px-4 pb-10 pt-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text className="text-4xl font-bold tracking-tight text-foreground">Skipper</Text>
            <Text className="text-base leading-6 text-muted-foreground">
              {t('onboarding.intro')}
            </Text>
          </View>

          <DeviceForm value={target} onChange={setTarget} />

          <Section
            title={t('onboarding.remote')}
            footer={
              target.kind === 'browser'
                ? t('onboarding.footerBrowser')
                : t('onboarding.footerAndroid')
            }
          >
            <Field
              label={t('onboarding.relayServer')}
              value={relay}
              onChangeText={setRelay}
              placeholder="wss://relay.example.com"
              keyboardType="url"
            />
          </Section>

          <PrimaryButton
            label={t('onboarding.start')}
            disabled={!valid || needsRelay}
            onPress={() => {
              if (relay.trim()) set({ relayUrl: relay.trim() });
              upsert(target);
              router.replace('/');
            }}
          />
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}
