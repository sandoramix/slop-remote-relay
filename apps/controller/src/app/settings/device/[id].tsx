import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardSafe } from '../../../components/KeyboardSafe';
import { Alert, ScrollView } from 'react-native';
import { DeviceForm, emptyTarget } from '../../../components/DeviceForm';
import { PrimaryButton, SmallButton } from '../../../components/form';
import { useT } from '../../../lib/i18n';
import { palette } from '../../../lib/palette';
import { TargetSchema, useSettings } from '../../../state/settings';

/** Edit a paired device, or add one when the id is "new". */
export default function DeviceEditor() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = useSettings((s) => s.targets.find((t) => t.id === id));
  const [draft, setDraft] = useState(() => existing ?? emptyTarget());
  const upsert = useSettings((s) => s.upsertTarget);
  const remove = useSettings((s) => s.removeTarget);
  const count = useSettings((s) => s.targets.length);
  const valid = TargetSchema.safeParse(draft).success;

  return (
    <KeyboardSafe>
      <Stack.Screen options={{ title: existing ? existing.name : t('nav.newDevice') }} />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        <DeviceForm value={draft} onChange={setDraft} />
        <PrimaryButton
          label={existing ? t('common.save') : t('common.add')}
          disabled={!valid}
          onPress={() => {
            upsert(draft);
            if (!existing) useSettings.getState().setActiveTarget(draft.id);
            router.back();
          }}
        />
        {existing && count > 1 ? (
          <SmallButton
            label={t('device.remove')}
            tone="danger"
            icon={<Trash2 size={16} color={palette.destructive} />}
            onPress={() =>
              Alert.alert(t('device.removeTitle'), t('device.removeBody', { name: existing.name }), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.remove'),
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
    </KeyboardSafe>
  );
}
