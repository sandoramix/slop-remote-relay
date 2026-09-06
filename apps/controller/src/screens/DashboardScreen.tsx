import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DeviceStatus, TopologySnapshot } from '@relay/protocol';
import type { RelayClient } from '../transport/RelayClient';
import type { Settings } from '../state/settings';
import { ConnectionStrip, t } from '../components/theme';

interface Props {
  client: RelayClient;
  settings: Settings;
  topology: TopologySnapshot | null;
  status: DeviceStatus | null;
  onOpenSettings: () => void;
}

/**
 * The remote itself. Two jobs, both reachable with a thumb:
 * seek by a preset amount, and force the foreground app to fullscreen.
 */
export function DashboardScreen({
  client,
  settings,
  topology,
  status,
  onOpenSettings,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>('');

  const run = useCallback(
    async (key: string, action: () => Promise<{ ok: boolean; executedBy?: string; detail?: string }>) => {
      setBusy(key);
      try {
        const ack = await action();
        setFeedback(
          ack.ok
            ? `Fatto via ${ack.executedBy ?? 'ricevitore'}`
            : `Non riuscito: ${ack.detail ?? 'motivo sconosciuto'}`,
        );
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const targetLabel = status?.foregroundPackage
    ? prettyPackage(status.foregroundPackage)
    : 'In attesa del ricevitore';

  return (
    <View style={s.root}>
      <View style={s.header}>
        <ConnectionStrip topology={topology} />
        <View style={s.targetRow}>
          <Text style={s.target}>{targetLabel}</Text>
          <Pressable onPress={onOpenSettings} hitSlop={12}>
            <Text style={s.settingsLink}>Impostazioni</Text>
          </Pressable>
        </View>
        {status && !status.recipeKnown && status.foregroundPackage ? (
          <Text style={s.notice}>
            Nessuna ricetta per questa app. Il fullscreen userà il tap appreso.
          </Text>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [s.fullscreen, pressed && s.pressed]}
        onPress={() => run('fs', () => client.fullscreen(true))}
        disabled={busy !== null}
      >
        {busy === 'fs' ? (
          <ActivityIndicator color={t.accentInk} />
        ) : (
          <Text style={s.fullscreenLabel}>Schermo intero</Text>
        )}
      </Pressable>

      <View style={s.seekGrid}>
        {settings.seekPresets.map((seconds) => (
          <View key={seconds} style={s.seekRow}>
            <SeekButton
              label={`−${seconds}s`}
              busy={busy === `back-${seconds}`}
              disabled={busy !== null}
              onPress={() => run(`back-${seconds}`, () => client.seek(-seconds * 1000))}
            />
            <SeekButton
              label={`+${seconds}s`}
              busy={busy === `fwd-${seconds}`}
              disabled={busy !== null}
              onPress={() => run(`fwd-${seconds}`, () => client.seek(seconds * 1000))}
            />
          </View>
        ))}
      </View>

      <View style={s.footer}>
        <Pressable
          style={({ pressed }) => [s.secondary, pressed && s.pressed]}
          onPress={() => run('pp', () => client.playPause())}
          disabled={busy !== null}
        >
          <Text style={s.secondaryLabel}>Play / Pausa</Text>
        </Pressable>
        <Text style={s.feedback} numberOfLines={2}>
          {feedback}
        </Text>
      </View>
    </View>
  );
}

function SeekButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.seek, pressed && s.pressed]}
      onPress={onPress}
      disabled={disabled}
    >
      {busy ? (
        <ActivityIndicator color={t.ink} />
      ) : (
        <Text style={s.seekLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

function prettyPackage(pkg: string): string {
  const known: Record<string, string> = {
    'com.google.android.youtube': 'YouTube',
    'com.brave.browser': 'Brave',
    'com.android.chrome': 'Chrome',
    'org.mozilla.firefox': 'Firefox',
  };
  return known[pkg] ?? pkg;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.canvas, padding: t.space.md, gap: t.space.md },
  header: { gap: t.space.sm },
  targetRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  target: { color: t.ink, fontSize: 22, fontWeight: '600', letterSpacing: -0.3 },
  settingsLink: { color: t.inkMuted, fontSize: 14 },
  notice: { color: t.inkMuted, fontSize: 13, lineHeight: 18 },

  fullscreen: {
    backgroundColor: t.accent,
    borderRadius: t.radius.panel,
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenLabel: { color: t.accentInk, fontSize: 20, fontWeight: '700' },

  seekGrid: { flex: 1, gap: t.space.sm },
  seekRow: { flex: 1, flexDirection: 'row', gap: t.space.sm },
  seek: {
    flex: 1,
    backgroundColor: t.panel,
    borderRadius: t.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekLabel: { color: t.ink, fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.72 },

  footer: { gap: t.space.sm },
  secondary: {
    backgroundColor: t.panel,
    borderRadius: t.radius.button,
    paddingVertical: t.space.md,
    alignItems: 'center',
  },
  secondaryLabel: { color: t.ink, fontSize: 16 },
  feedback: { color: t.inkMuted, fontSize: 13, minHeight: 34 },
});
