import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { uuid } from '../lib/crypto';
import { palette } from '../lib/palette';
import { TargetSchema, useSettings } from '../state/settings';

/**
 * Pairing by link: relay://pair?code=…&name=…&kind=android|browser&relay=…&lan=…
 *
 * This is what a receiver's QR code encodes, so pairing is "point the camera,
 * tap the link". A code that is already paired updates that device instead of
 * adding a duplicate.
 */
export default function Pair() {
  const params = useLocalSearchParams<{
    code?: string;
    name?: string;
    kind?: string;
    relay?: string;
    lan?: string;
  }>();
  const hydrated = useSettings((s) => s.hydrated);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hydrated || done) return;
    const state = useSettings.getState();
    const existing = state.targets.find((t) => t.pairCode === params.code);
    const candidate = TargetSchema.safeParse({
      id: existing?.id ?? uuid(),
      name: params.name || existing?.name || (params.kind === 'browser' ? 'Browser' : 'Telefono'),
      kind: params.kind === 'browser' ? 'browser' : 'android',
      pairCode: params.code ?? '',
      lanHost: params.lan || existing?.lanHost || null,
    });
    if (candidate.success) {
      if (params.relay && /^wss?:\/\//.test(params.relay)) state.set({ relayUrl: params.relay });
      state.upsertTarget(candidate.data);
      state.setActiveTarget(candidate.data.id);
    }
    setDone(true);
  }, [hydrated, done, params]);

  if (!done) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }
  return <Redirect href="/" />;
}
