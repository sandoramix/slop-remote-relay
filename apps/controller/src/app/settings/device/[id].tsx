import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { DeviceForm, emptyTarget } from '../../../components/DeviceForm';
import { PrimaryButton, SmallButton } from '../../../components/form';
import { palette } from '../../../lib/palette';
import { TargetSchema, useSettings } from '../../../state/settings';

/** Edit a paired device, or add one when the id is "new". */
export default function DeviceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = useSettings((s) => s.targets.find((t) => t.id === id));
  const [draft, setDraft] = useState(() => existing ?? emptyTarget());
  const upsert = useSettings((s) => s.upsertTarget);
  const remove = useSettings((s) => s.removeTarget);
  const count = useSettings((s) => s.targets.length);
  const valid = TargetSchema.safeParse(draft).success;

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? existing.name : 'Nuovo dispositivo' }} />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        <DeviceForm value={draft} onChange={setDraft} />
        <PrimaryButton
          label={existing ? 'Salva' : 'Aggiungi'}
          disabled={!valid}
          onPress={() => {
            upsert(draft);
            if (!existing) useSettings.getState().setActiveTarget(draft.id);
            router.back();
          }}
        />
        {existing && count > 1 ? (
          <SmallButton
            label="Rimuovi dispositivo"
            tone="danger"
            icon={<Trash2 size={16} color={palette.destructive} />}
            onPress={() =>
              Alert.alert('Rimuovere il dispositivo?', `${existing.name} non sarà più comandabile da qui.`, [
                { text: 'Annulla', style: 'cancel' },
                {
                  text: 'Rimuovi',
                  style: 'destructive',
                  onPress: () => {
                    remove(existing.id);
                    router.back();
                  },
                },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
