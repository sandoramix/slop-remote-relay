import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Section } from '../../components/form';
import { StateDot } from '../../components/StateDot';
import { haptic } from '../../lib/haptics';
import { palette } from '../../lib/palette';
import { plan } from '../../lib/transports/registry';
import { useSession } from '../../state/session';
import { roomFromPairCode } from '../../lib/crypto';
import { normalizeOrder, useActiveTarget, useSettings } from '../../state/settings';

/**
 * The failover order, owned by the user and persisted.
 *
 * The first path that is enabled and reachable carries commands; every other
 * one stays connected in the background, so dropping to the next is instant.
 * Moving back up waits for 15 seconds of continuous health, which stops the
 * app flapping between two paths at the edge of Wi-Fi coverage.
 */
export default function TransportsScreen() {
  const settings = useSettings();
  const target = useActiveTarget();
  const topology = useSession((s) => s.topology);
  const order = normalizeOrder(settings.transportOrder);

  const planned = target
    ? plan({ target, settings, room: roomFromPairCode(target.pairCode), hmac: async () => '' })
    : order.map((id) => ({ meta: { id } as never, skipped: null }));
  let rank = 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2">
      <Text className="px-1 text-sm leading-5 text-muted-foreground">
        Il primo percorso disponibile porta i comandi; gli altri restano pronti come riserva. Usa le
        frecce per cambiare l'ordine.
      </Text>

      <Section
        title={target ? `Ordine per ${target.name}` : 'Ordine'}
        footer="L'ordine vale per tutti i dispositivi; i percorsi che un dispositivo non supporta vengono saltati."
      >
        {planned.map(({ meta, skipped }, index) => {
          const enabled = settings.transportEnabled[meta.id] ?? true;
          const live = topology?.transports.find((t) => t.id === meta.id);
          const position = skipped ? null : ++rank;
          return (
            <View key={meta.id}>
              {index > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 py-3 pl-3 pr-4">
                <View className="w-7 items-center">
                  {position ? (
                    <View className={`h-7 w-7 items-center justify-center rounded-full ${position === 1 ? 'bg-primary' : 'bg-secondary'}`}>
                      <Text className={`text-xs font-bold ${position === 1 ? 'text-primary-foreground' : 'text-foreground'}`}>
                        {position}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-muted-foreground">–</Text>
                  )}
                </View>
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text className={`text-base font-medium ${skipped ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {meta.label}
                    </Text>
                    {live ? <StateDot state={live.state} active={live.active} /> : null}
                  </View>
                  <Text className="text-xs leading-4 text-muted-foreground">{skipped ?? meta.summary}</Text>
                </View>
                <View className="gap-1">
                  <Arrow up disabled={index === 0} onPress={() => settings.moveTransport(meta.id, -1)} />
                  <Arrow disabled={index === order.length - 1} onPress={() => settings.moveTransport(meta.id, 1)} />
                </View>
                <Switch
                  value={enabled}
                  onValueChange={(v) => {
                    haptic.tap();
                    settings.toggleTransport(meta.id, v);
                  }}
                  trackColor={{ false: palette.secondary, true: palette.primary }}
                  thumbColor={palette.foreground}
                  accessibilityLabel={`Attiva ${meta.label}`}
                />
              </View>
            </View>
          );
        })}
      </Section>
    </ScrollView>
  );
}

function Arrow({ up, disabled, onPress }: { up?: boolean; disabled: boolean; onPress: () => void }) {
  const Icon = up ? ChevronUp : ChevronDown;
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={up ? 'Sposta su' : 'Sposta giù'}
      className={`h-7 w-8 items-center justify-center rounded-lg bg-secondary ${disabled ? 'opacity-30' : ''} active:bg-accent`}
    >
      <Icon size={16} color={palette.foreground} />
    </Pressable>
  );
}
