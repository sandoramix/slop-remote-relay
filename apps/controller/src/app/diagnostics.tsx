import type { TransportId } from '@relay/protocol';
import { RefreshCw } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Section } from '../components/form';
import { EXECUTOR_LABEL, prettySource } from '../lib/format';
import { palette } from '../lib/palette';
import { TRANSPORTS } from '../lib/transports/registry';
import { useSession } from '../state/session';
import { StateDot } from '../components/StateDot';

const STATE_LABEL: Record<string, string> = {
  idle: 'fermo',
  connecting: 'connessione…',
  connected: 'collegato',
  degraded: 'instabile',
  failed: 'non raggiungibile',
};

/** Every path's health, the receiver's capabilities, and a short event log. */
export default function Diagnostics() {
  const topology = useSession((s) => s.topology);
  const status = useSession((s) => s.status);
  const log = useSession((s) => s.log);
  const client = useSession((s) => s.client);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2">
      <Section title="Percorsi">
        {topology?.transports.length ? (
          topology.transports.map((t, i) => (
            <View key={t.id}>
              {i > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 px-4 py-3">
                <StateDot state={t.state} active={t.active} />
                <Text className="flex-1 text-base text-foreground">
                  {TRANSPORTS[t.id as TransportId]?.label ?? t.label}
                </Text>
                <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {t.rttMs != null ? `${t.rttMs} ms` : STATE_LABEL[t.state] ?? t.state}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text className="px-4 py-3 text-sm text-muted-foreground">Nessun percorso attivo</Text>
        )}
      </Section>

      <Section title="Ricevitore">
        <Row label="App in primo piano" value={prettySource(status?.foregroundPackage) ?? '—'} />
        <Row label="Sessione multimediale" value={status ? (status.hasMediaSession ? 'sì' : 'no') : '—'} />
        <Row
          label="Esecutori"
          value={status?.executors.length ? status.executors.map((e) => EXECUTOR_LABEL[e] ?? e).join(', ') : '—'}
        />
        <Row label="Ricetta per l'app" value={status ? (status.recipeKnown ? 'sì' : 'generica') : '—'} />
        <Row label="Batteria" value={status?.batteryPercent != null ? `${status.batteryPercent}%` : '—'} />
      </Section>

      <View className="gap-2">
        <View className="flex-row items-center justify-between px-1">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Eventi</Text>
          <Pressable
            onPress={() => void client?.refreshStatus().catch(() => undefined)}
            hitSlop={8}
            accessibilityLabel="Aggiorna"
          >
            <RefreshCw size={16} color={palette.muted} />
          </Pressable>
        </View>
        <View className="gap-1 rounded-2xl border border-border bg-card p-3">
          {log.length === 0 ? (
            <Text className="text-xs text-muted-foreground">Ancora niente.</Text>
          ) : (
            log.map((l, i) => (
              <Text
                key={`${l.at}-${i}`}
                className={`text-xs ${l.tone === 'error' ? 'text-destructive' : l.tone === 'ok' ? 'text-success' : 'text-muted-foreground'}`}
                style={{ fontFamily: 'monospace' }}
              >
                {new Date(l.at).toLocaleTimeString()} {l.text}
              </Text>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-b-0">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-shrink text-right text-sm text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
