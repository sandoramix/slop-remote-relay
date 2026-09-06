import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { Settings } from '../state/settings';
import { t } from '../components/theme';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  onDiscover: () => Promise<string | null>;
}

/**
 * Pairing and transport configuration. The pair code is the single secret: both
 * the relay room id and the HMAC key are derived from it, so the user types one
 * string on each device and nothing else.
 */
export function SettingsScreen({ settings, onChange, onClose, onDiscover }: Props) {
  const [presetDraft, setPresetDraft] = useState(settings.seekPresets.join(', '));
  const [scanning, setScanning] = useState(false);

  const commitPresets = () => {
    const parsed = presetDraft
      .split(',')
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((v) => Number.isFinite(v) && v > 0 && v <= 3600)
      .slice(0, 4);
    if (parsed.length) onChange({ ...settings, seekPresets: parsed });
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.titleRow}>
        <Text style={s.title}>Impostazioni</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={s.close}>Chiudi</Text>
        </Pressable>
      </View>

      <Field label="Codice di accoppiamento" hint="Lo stesso su entrambi i dispositivi.">
        <TextInput
          style={s.input}
          value={settings.pairCode}
          onChangeText={(pairCode) => onChange({ ...settings, pairCode })}
          autoCapitalize="none"
          placeholder="es. cielo-lento-42"
          placeholderTextColor={t.down}
        />
      </Field>

      <Field label="Salti di ricerca" hint="Secondi, separati da virgola. Massimo quattro.">
        <TextInput
          style={s.input}
          value={presetDraft}
          onChangeText={setPresetDraft}
          onBlur={commitPresets}
          keyboardType="number-pad"
        />
      </Field>

      <Field label="Indirizzo sulla rete locale" hint="Rilevato automaticamente quando siete sulla stessa Wi-Fi.">
        <View style={s.row}>
          <TextInput
            style={[s.input, s.rowInput]}
            value={settings.lanHost ?? ''}
            onChangeText={(lanHost) => onChange({ ...settings, lanHost: lanHost || null })}
            autoCapitalize="none"
            placeholder="192.168.1.20"
            placeholderTextColor={t.down}
          />
          <Pressable
            style={s.smallButton}
            disabled={scanning}
            onPress={async () => {
              setScanning(true);
              const host = await onDiscover();
              if (host) onChange({ ...settings, lanHost: host });
              setScanning(false);
            }}
          >
            <Text style={s.smallButtonLabel}>{scanning ? 'Cerco…' : 'Cerca'}</Text>
          </Pressable>
        </View>
      </Field>

      <Field label="Relay remoto" hint="Usato quando la rete locale non è raggiungibile.">
        <TextInput
          style={s.input}
          value={settings.relayUrl ?? ''}
          onChangeText={(relayUrl) => onChange({ ...settings, relayUrl: relayUrl || null })}
          autoCapitalize="none"
          placeholder="wss://relay.example.com"
          placeholderTextColor={t.down}
        />
      </Field>

      <Toggle
        label="Duplica i comandi su due percorsi"
        hint="Il ricevitore scarta il doppione. Costa un frame in più, evita comandi persi durante un cambio di rete."
        value={settings.mirrorCritical}
        onValueChange={(mirrorCritical) => onChange({ ...settings, mirrorCritical })}
      />
    </ScrollView>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

function Toggle({ label, hint, value, onValueChange }: { label: string; hint: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={[s.field, s.toggleRow]}>
      <View style={s.toggleText}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.hint}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: t.accent, false: t.hairline }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.canvas },
  content: { padding: t.space.md, gap: t.space.lg, paddingBottom: t.space.xl },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: t.ink, fontSize: 26, fontWeight: '600', letterSpacing: -0.4 },
  close: { color: t.accent, fontSize: 15 },
  field: { gap: t.space.xs },
  label: { color: t.ink, fontSize: 15, fontWeight: '500' },
  hint: { color: t.inkMuted, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: t.panel,
    borderRadius: t.radius.button,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm + 2,
    color: t.ink,
    fontSize: 16,
  },
  row: { flexDirection: 'row', gap: t.space.sm },
  rowInput: { flex: 1 },
  smallButton: { backgroundColor: t.panel, borderRadius: t.radius.button, paddingHorizontal: t.space.md, justifyContent: 'center' },
  smallButtonLabel: { color: t.accent, fontSize: 15 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  toggleText: { flex: 1, gap: t.space.xs },
});
