import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeviceForm, emptyTarget } from '../components/DeviceForm';
import { Field, PrimaryButton, Section } from '../components/form';
import { TargetSchema, useSettings } from '../state/settings';

/**
 * First run: pair one device. Kept to a single screen — a code, a name, and
 * optionally a relay — because the receiver shows the same code and there is
 * nothing else to configure before the remote is useful.
 */
export default function Onboarding() {
  const [target, setTarget] = useState(() => emptyTarget());
  const relayUrl = useSettings((s) => s.relayUrl);
  const [relay, setRelay] = useState(relayUrl ?? '');
  const upsert = useSettings((s) => s.upsertTarget);
  const set = useSettings((s) => s.set);
  const valid = TargetSchema.safeParse(target).success;
  const needsRelay = target.kind === 'browser' && !relay.trim();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="gap-8 px-4 pb-10 pt-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text className="text-4xl font-bold tracking-tight text-foreground">Relay</Text>
            <Text className="text-base leading-6 text-muted-foreground">
              Il telecomando per il video che stai guardando su un altro schermo. Associa il primo
              dispositivo per iniziare.
            </Text>
          </View>

          <DeviceForm value={target} onChange={setTarget} />

          <Section
            title="Da remoto"
            footer={
              target.kind === 'browser'
                ? "Il browser si raggiunge solo via internet: serve l'indirizzo del tuo relay."
                : 'Facoltativo. Senza relay restano Wi-Fi locale, Bluetooth e MQTT.'
            }
          >
            <Field
              label="Server relay"
              value={relay}
              onChangeText={setRelay}
              placeholder="wss://relay.esempio.it"
              keyboardType="url"
            />
          </Section>

          <PrimaryButton
            label="Inizia"
            disabled={!valid || needsRelay}
            onPress={() => {
              if (relay.trim()) set({ relayUrl: relay.trim() });
              upsert(target);
              router.replace('/');
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
