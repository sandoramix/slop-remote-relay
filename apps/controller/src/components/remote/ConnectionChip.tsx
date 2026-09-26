import type { TransportId } from '@relay/protocol';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { palette } from '../../lib/palette';
import { TRANSPORTS } from '../../lib/transports/registry';
import { useSession } from '../../state/session';

/**
 * The live path, at a glance: which transport is carrying commands right now,
 * its round trip, and how many others are standing by warm. Tapping opens the
 * diagnostics screen with every path's health.
 */
export function ConnectionChip() {
  const topology = useSession((s) => s.topology);
  const error = useSession((s) => s.error);

  const active = topology?.transports.find((t) => t.active) ?? null;
  const standby = topology?.transports.filter((t) => !t.active && t.state === 'connected').length ?? 0;
  const connecting = topology?.transports.some((t) => t.state === 'connecting') ?? true;

  let tone: string = palette.muted;
  let label = 'Connessione…';
  if (error) {
    tone = palette.destructive;
    label = error;
  } else if (active) {
    tone = palette.success;
    label = TRANSPORTS[active.id as TransportId]?.label ?? active.label;
  } else if (!connecting) {
    tone = palette.destructive;
    label = 'Nessun percorso raggiungibile';
  }

  return (
    <Pressable
      onPress={() => router.push('/diagnostics')}
      accessibilityRole="button"
      accessibilityLabel={`Connessione: ${label}. Apri la diagnostica`}
      className="flex-row items-center gap-2 self-start rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
        {label}
      </Text>
      {active?.rttMs != null ? (
        <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {active.rttMs} ms
        </Text>
      ) : null}
      {standby > 0 ? (
        <Text className="text-xs text-muted-foreground">+{standby} di riserva</Text>
      ) : null}
      <ChevronRight size={14} color={palette.muted} />
    </Pressable>
  );
}
