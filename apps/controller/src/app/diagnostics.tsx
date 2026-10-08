import type { TransportId } from '@relay/protocol';
import { RefreshCw } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Section } from '../components/form';
import { executorLabel, prettySource } from '../lib/format';
import { useT, type TranslationKey } from '../lib/i18n';
import { palette } from '../lib/palette';
import { TRANSPORTS } from '../lib/transports/registry';
import { useSession } from '../state/session';
import { StateDot } from '../components/StateDot';

const STATE_LABEL: Record<string, TranslationKey> = {
  idle: 'state.idle',
  connecting: 'state.connecting',
  connected: 'state.connected',
  degraded: 'state.degraded',
  failed: 'state.failed',
};

/** Every path's health, the receiver's capabilities, and a short event log. */
export default function Diagnostics() {
  const t = useT();
  const topology = useSession((s) => s.topology);
  const status = useSession((s) => s.status);
  const log = useSession((s) => s.log);
  const client = useSession((s) => s.client);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2">
      <Section title={t('diag.paths')}>
        {topology?.transports.length ? (
          topology.transports.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 px-4 py-3">
                <StateDot state={p.state} active={p.active} />
                <Text className="flex-1 text-base text-foreground">
                  {TRANSPORTS[p.id as TransportId]?.label ?? p.label}
                </Text>
                <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {p.rttMs != null ? `${p.rttMs} ms` : STATE_LABEL[p.state] ? t(STATE_LABEL[p.state]!) : p.state}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text className="px-4 py-3 text-sm text-muted-foreground">{t('diag.noPaths')}</Text>
        )}
      </Section>

      <Section title={t('diag.receiver')}>
        <Row label={t('diag.foregroundApp')} value={prettySource(status?.foregroundPackage) ?? '—'} />
        <Row label={t('diag.mediaSession')} value={status ? (status.hasMediaSession ? t('common.yes') : t('common.no')) : '—'} />
        <Row
          label={t('diag.executors')}
          value={status?.executors.length ? status.executors.map((e) => executorLabel(e)).join(', ') : '—'}
        />
        <Row label={t('diag.recipe')} value={status ? (status.recipeKnown ? t('common.yes') : t('diag.recipeGeneric')) : '—'} />
        <Row label={t('diag.battery')} value={status?.batteryPercent != null ? `${status.batteryPercent}%` : '—'} />
      </Section>

      <View className="gap-2">
        <View className="flex-row items-center justify-between px-1">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('diag.events')}</Text>
          <Pressable
            onPress={() => void client?.refreshStatus().catch(() => undefined)}
            hitSlop={8}
            accessibilityLabel={t('diag.refresh')}
          >
            <RefreshCw size={16} color={palette.muted} />
          </Pressable>
        </View>
        <View className="gap-1 rounded-2xl border border-border bg-card p-3">
          {log.length === 0 ? (
            <Text className="text-xs text-muted-foreground">{t('diag.noEvents')}</Text>
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
