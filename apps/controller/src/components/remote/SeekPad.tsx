import { Check, Plus, RotateCcw, RotateCw, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { jumpLabel, parseJump } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { palette } from '../../lib/palette';
import { useSettings } from '../../state/settings';
import { useCommand, useCommandState } from './useCommand';

/** First repeat after the hold is recognised, then this often while held. */
const REPEAT_MS = 650;

/**
 * Pick a jump, then press back or forward.
 *
 * The amount is free: the chips are the user's presets (any number, any size),
 * and "Altro" takes a typed value like 45, 2m, 1:30 or 1h. Two oversized keys do
 * the jumping, so the thumb finds them without looking; holding one repeats.
 */
export function SeekPad() {
  const presets = useSettings((s) => s.seekPresets);
  const selected = useSettings((s) => s.selectedSeek);
  const set = useSettings((s) => s.set);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const parsed = parseJump(draft);

  const chips = presets.includes(selected) ? presets : [...presets, selected].sort((a, b) => a - b);

  const commitCustom = (save: boolean) => {
    if (!parsed) return;
    haptic.tap();
    const next: Partial<ReturnType<typeof useSettings.getState>> = { selectedSeek: parsed };
    if (save && !presets.includes(parsed)) next.seekPresets = [...presets, parsed].sort((a, b) => a - b);
    set(next);
    setDraft('');
    setEditing(false);
  };

  return (
    <View className="gap-4">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
        {chips.map((seconds) => {
          const on = seconds === selected;
          return (
            <Pressable
              key={seconds}
              onPress={() => {
                haptic.tap();
                set({ selectedSeek: seconds });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              className={`rounded-full border px-4 py-2 ${on ? 'border-primary bg-primary/15' : 'border-border bg-card'} active:opacity-70`}
            >
              <Text className={`text-sm font-semibold ${on ? 'text-primary' : 'text-foreground'}`}>
                {jumpLabel(seconds)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setEditing((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Salto personalizzato"
          className="flex-row items-center gap-1 rounded-full border border-dashed border-border px-4 py-2 active:opacity-70"
        >
          <Plus size={14} color={palette.muted} />
          <Text className="text-sm font-medium text-muted-foreground">Altro</Text>
        </Pressable>
      </ScrollView>

      {editing ? (
        <View className="gap-2 rounded-2xl border border-border bg-card p-3">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="es. 45, 2m, 1:30, 1h"
              placeholderTextColor={palette.muted}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              onSubmitEditing={() => commitCustom(false)}
              className="h-11 flex-1 rounded-xl bg-secondary px-3 text-base text-foreground"
            />
            <Pressable
              onPress={() => commitCustom(false)}
              disabled={!parsed}
              className={`h-11 w-11 items-center justify-center rounded-xl ${parsed ? 'bg-primary' : 'bg-secondary'}`}
              accessibilityLabel="Usa questo salto"
            >
              <Check size={20} color={parsed ? palette.primaryInk : palette.muted} />
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
              accessibilityLabel="Annulla"
            >
              <X size={20} color={palette.muted} />
            </Pressable>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-xs text-muted-foreground">
              {draft ? (parsed ? `= ${jumpLabel(parsed)}` : 'Formato non riconosciuto') : 'Qualsiasi durata, fino a 24 ore'}
            </Text>
            {parsed ? (
              <Pressable onPress={() => commitCustom(true)} hitSlop={8}>
                <Text className="text-xs font-semibold text-primary">Salva fra i preferiti</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <SeekKey direction={-1} seconds={selected} />
        <SeekKey direction={1} seconds={selected} />
      </View>
    </View>
  );
}

function SeekKey({ direction, seconds }: { direction: -1 | 1; seconds: number }) {
  const run = useCommand();
  const busy = useCommandState((s) => s.busy);
  const key = direction < 0 ? 'back' : 'fwd';
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState(false);
  const Icon = direction < 0 ? RotateCcw : RotateCw;

  const fire = (quiet = false) =>
    void run(key, (c) => c.seek(direction * seconds * 1000), { quiet });

  const stop = () => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
    setHolding(false);
  };

  return (
    <Pressable
      onPress={() => fire()}
      onLongPress={() => {
        haptic.heavy();
        setHolding(true);
        fire(true);
        repeat.current = setInterval(() => fire(true), REPEAT_MS);
      }}
      onPressOut={stop}
      delayLongPress={450}
      disabled={busy !== null && busy !== key}
      accessibilityRole="button"
      accessibilityLabel={`${direction < 0 ? 'Indietro' : 'Avanti'} di ${jumpLabel(seconds)}`}
      accessibilityHint="Tieni premuto per ripetere"
      className={`h-36 flex-1 items-center justify-center gap-2 rounded-3xl border ${holding ? 'border-primary bg-primary/10' : 'border-border bg-secondary'} active:bg-accent`}
    >
      {busy === key && !holding ? (
        <ActivityIndicator color={palette.foreground} />
      ) : (
        <Icon size={30} color={holding ? palette.primary : palette.foreground} />
      )}
      <Text
        className={`text-3xl font-semibold ${holding ? 'text-primary' : 'text-foreground'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {direction < 0 ? '−' : '+'}
        {jumpLabel(seconds)}
      </Text>
    </Pressable>
  );
}
