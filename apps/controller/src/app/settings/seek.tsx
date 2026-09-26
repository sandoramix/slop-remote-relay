import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Field, Section, SmallButton } from '../../components/form';
import { jumpLabel, parseJump } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { palette } from '../../lib/palette';
import { useSettings } from '../../state/settings';

/** The jump chips on the remote. No limit on how many, or how large. */
export default function SeekScreen() {
  const presets = useSettings((s) => s.seekPresets);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState('');
  const parsed = parseJump(draft);
  const duplicate = parsed != null && presets.includes(parsed);

  const add = () => {
    if (!parsed || duplicate) return;
    haptic.tap();
    set({ seekPresets: [...presets, parsed].sort((a, b) => a - b) });
    setDraft('');
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2" keyboardShouldPersistTaps="handled">
      <Section title="Preferiti" footer="Tocca un salto per rimuoverlo. Ne resta sempre almeno uno.">
        <View className="flex-row flex-wrap gap-2 p-3">
          {presets.map((seconds) => (
            <Pressable
              key={seconds}
              disabled={presets.length === 1}
              onPress={() => {
                haptic.tap();
                set({ seekPresets: presets.filter((p) => p !== seconds) });
              }}
              accessibilityLabel={`Rimuovi ${jumpLabel(seconds)}`}
              className="flex-row items-center gap-1.5 rounded-full border border-border bg-secondary py-2 pl-4 pr-3 active:opacity-70"
            >
              <Text className="text-sm font-semibold text-foreground">{jumpLabel(seconds)}</Text>
              {presets.length > 1 ? <X size={14} color={palette.muted} /> : null}
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Aggiungi">
        <Field
          label="Durata"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="45, 2m, 1:30, 1h"
          keyboardType="numbers-and-punctuation"
          error={draft && !parsed ? 'Formato non riconosciuto' : duplicate ? 'È già fra i preferiti' : null}
          hint={parsed ? `= ${jumpLabel(parsed)}` : 'Secondi, minuti (2m), ore (1h) o mm:ss'}
          right={
            <SmallButton
              label="Aggiungi"
              tone="primary"
              icon={<Plus size={14} color={palette.primaryInk} />}
              onPress={add}
              disabled={!parsed || duplicate}
            />
          }
        />
      </Section>
    </ScrollView>
  );
}
