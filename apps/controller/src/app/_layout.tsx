import '../../global.css';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { palette } from '../lib/palette';
import { useRelayConnection } from '../state/session';
import { useSettings } from '../state/settings';
import { useUpdate } from '../state/update';

// Keep the splash up until settings are loaded, so the first frame already
// knows whether to show onboarding or the remote.
void SplashScreen.preventAutoHideAsync();

function KeepAwake() {
  useKeepAwake('relay-remote');
  return null;
}

function Connection() {
  useRelayConnection();
  return null;
}

/** Asks GitHub for a newer release at start, at most every 12 hours. */
function UpdateCheck() {
  const check = useUpdate((s) => s.check);
  useEffect(() => {
    void check();
  }, [check]);
  return null;
}

export default function RootLayout() {
  const keepAwake = useSettings((s) => s.keepAwake);
  const hydrated = useSettings((s) => s.hydrated);
  const paired = useSettings((s) => s.targets.length > 0);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <SafeAreaProvider>
      <GluestackUIProvider mode="dark">
        <StatusBar style="light" />
        <Connection />
        <UpdateCheck />
        {keepAwake ? <KeepAwake /> : null}
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.background },
            headerTintColor: palette.foreground,
            headerTitleStyle: { fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: palette.background },
            animation: 'slide_from_right',
          }}
        >
          {/*
            Which half of the app exists is decided here, not by a <Redirect>
            inside the first screen: redirecting away from the initial route
            during startup left the destination screen invisible on Android
            (the black screen after the splash in v0.2.0/v0.2.1). With guards
            the navigator starts on the right screen and switches by itself
            when the first device is paired or the last one removed.
          */}
          <Stack.Protected guard={paired}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="diagnostics" options={{ title: 'Diagnostica' }} />
            <Stack.Screen name="settings/index" options={{ title: 'Impostazioni' }} />
            <Stack.Screen name="settings/transports" options={{ title: 'Percorsi e priorità' }} />
            <Stack.Screen name="settings/seek" options={{ title: 'Salti' }} />
            <Stack.Screen name="settings/servers" options={{ title: 'Server' }} />
            <Stack.Screen name="settings/device/[id]" options={{ title: 'Dispositivo' }} />
          </Stack.Protected>
          <Stack.Protected guard={!paired}>
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          </Stack.Protected>
          {/* A pairing link works in both states. */}
          <Stack.Screen name="pair" options={{ headerShown: false }} />
        </Stack>
      </GluestackUIProvider>
    </SafeAreaProvider>
  );
}
