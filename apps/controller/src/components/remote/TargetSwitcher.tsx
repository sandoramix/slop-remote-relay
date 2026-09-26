import { router } from 'expo-router';
import { Check, ChevronDown, Globe, Plus, Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { haptic } from '../../lib/haptics';
import { palette } from '../../lib/palette';
import { type Target, useActiveTarget, useSettings } from '../../state/settings';

export const KindIcon = ({ kind, size = 18, color = palette.foreground }: { kind: Target['kind']; size?: number; color?: string }) =>
  kind === 'browser' ? <Globe size={size} color={color} /> : <Smartphone size={size} color={color} />;

/** Name of the device being driven; tap to switch between paired devices. */
export function TargetSwitcher() {
  const target = useActiveTarget();
  const targets = useSettings((s) => s.targets);
  const setActive = useSettings((s) => s.setActiveTarget);
  const [open, setOpen] = useState(false);

  if (!target) return null;

  return (
    <>
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Dispositivo: ${target.name}. Cambia dispositivo`}
        className="flex-row items-center gap-2 active:opacity-70"
        hitSlop={8}
      >
        <KindIcon kind={target.kind} size={20} />
        <Text className="text-2xl font-semibold tracking-tight text-foreground" numberOfLines={1}>
          {target.name}
        </Text>
        <ChevronDown size={18} color={palette.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setOpen(false)}>
          <Pressable className="gap-1 rounded-t-3xl border-t border-border bg-card px-4 pb-10 pt-3">
            <View className="mb-3 h-1 w-10 self-center rounded-full bg-border" />
            <Text className="mb-2 px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Dispositivi
            </Text>
            {targets.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  haptic.tap();
                  setActive(t.id);
                  setOpen(false);
                }}
                className="flex-row items-center gap-3 rounded-2xl px-3 py-3.5 active:bg-accent"
              >
                <KindIcon kind={t.kind} />
                <View className="flex-1">
                  <Text className="text-base font-medium text-foreground">{t.name}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {t.kind === 'browser' ? 'Estensione del browser' : 'Telefono Android'}
                  </Text>
                </View>
                {t.id === target.id ? <Check size={18} color={palette.primary} /> : null}
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setOpen(false);
                router.push('/settings/device/new');
              }}
              className="mt-1 flex-row items-center gap-3 rounded-2xl px-3 py-3.5 active:bg-accent"
            >
              <Plus size={18} color={palette.primary} />
              <Text className="text-base font-medium text-primary">Aggiungi dispositivo</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
