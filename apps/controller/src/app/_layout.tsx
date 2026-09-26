import '../../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { palette } from '../lib/palette';
import { useRelayConnection } from '../state/session';
import { useSettings } from '../state/settings';

function KeepAwake() {
  useKeepAwake('relay-remote');
  return null;
}

function Connection() {
  useRelayConnection();
  return null;
}

export default function RootLayout() {
  const keepAwake = useSettings((s) => s.keepAwake);
  return (
    <SafeAreaProvider>
      <GluestackUIProvider mode="dark">
        <StatusBar style="light" />
        <Connection />
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
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ headerShown: false }} />
          <Stack.Screen name="diagnostics" options={{ title: 'Diagnostica' }} />
          <Stack.Screen name="settings/index" options={{ title: 'Impostazioni' }} />
          <Stack.Screen name="settings/transports" options={{ title: 'Percorsi e priorità' }} />
          <Stack.Screen name="settings/seek" options={{ title: 'Salti' }} />
          <Stack.Screen name="settings/servers" options={{ title: 'Server' }} />
          <Stack.Screen name="settings/device/[id]" options={{ title: 'Dispositivo' }} />
        </Stack>
      </GluestackUIProvider>
    </SafeAreaProvider>
  );
}
