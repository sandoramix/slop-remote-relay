import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import type { DeviceStatus, TopologySnapshot } from '@relay/protocol';
import { RelayClient } from './transport/RelayClient';
import { discoverReceiver } from './transport/LanWebSocketTransport';
import { DashboardScreen } from './screens/DashboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from './state/settings';
import { roomFromPairCode, secretFromPairCode } from './state/crypto';
import { t } from './components/theme';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const clientRef = useRef<RelayClient | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  // Rebuild the client whenever pairing or transport config changes. Cheap:
  // TransportManager tears down and redials every path in parallel.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!settings.pairCode) return;
      const [pairSecret, relayRoom] = await Promise.all([
        secretFromPairCode(settings.pairCode),
        roomFromPairCode(settings.pairCode),
      ]);
      if (cancelled) return;

      await clientRef.current?.stop();
      const client = new RelayClient(
        {
          pairSecret,
          relayRoom,
          lanHost: settings.lanHost,
          relayUrl: settings.relayUrl,
          bleDeviceId: settings.bleDeviceId,
          mirrorCritical: settings.mirrorCritical,
        },
        {
          onTopology: setTopology,
          onStatus: setStatus,
          onLog: (line) => console.log('[relay]', line),
        },
      );
      clientRef.current = client;
      await client.start().catch((e) => console.warn('[relay] start failed', e));
      void client.refreshStatus().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Poll device status while the dashboard is visible so the target label and
  // executor availability stay current without a push channel.
  useEffect(() => {
    if (showSettings) return;
    const timer = setInterval(() => {
      clientRef.current?.refreshStatus().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [showSettings]);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={t.canvas} />
      {showSettings || !settings.pairCode ? (
        <SettingsScreen
          settings={settings}
          onChange={persist}
          onClose={() => setShowSettings(false)}
          onDiscover={() => discoverReceiver()}
        />
      ) : (
        <DashboardScreen
          client={clientRef.current!}
          settings={settings}
          topology={topology}
          status={status}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.canvas },
});
