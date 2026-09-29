import type { TransportId } from '@relay/protocol';
import { router } from 'expo-router';
import { Activity, FastForward, Plus, Route, Server } from 'lucide-react-native';
import { Fragment } from 'react';
import { ScrollView, Text } from 'react-native';
import { Divider, LinkRow, Section, ToggleRow } from '../../components/form';
import { KindIcon } from '../../components/remote/TargetSwitcher';
import { jumpLabel } from '../../lib/format';
import { palette } from '../../lib/palette';
import { TRANSPORTS } from '../../lib/transports/registry';
import { isEnabled, normalizeOrder, useSettings } from '../../state/settings';

/** Host of a ws/wss/http URL, without throwing on a half-typed one. */
const hostOf = (raw: string) => raw.replace(/^[a-z]+:\/\//i, '').split('/')[0] || raw;

export default function SettingsScreen() {
  const s = useSettings();
  const order = normalizeOrder(s.transportOrder).filter((id) => isEnabled(s, id));
  const first = order[0] ? TRANSPORTS[order[0] as TransportId].label : 'nessuno';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2">
      <Section title="Dispositivi">
        {s.targets.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 ? <Divider /> : null}
            <LinkRow
              icon={<KindIcon kind={t.kind} color={palette.muted} />}
              label={t.name}
              value={t.id === s.activeTargetId ? 'in uso' : undefined}
              onPress={() => router.push(`/settings/device/${t.id}`)}
            />
          </Fragment>
        ))}
        <Divider />
        <LinkRow
          icon={<Plus size={18} color={palette.primary} />}
          label="Aggiungi dispositivo"
          onPress={() => router.push('/settings/device/new')}
        />
      </Section>

      <Section title="Connessione">
        <LinkRow
          icon={<Route size={18} color={palette.muted} />}
          label="Percorsi e priorità"
          value={`${first} per primo`}
          onPress={() => router.push('/settings/transports')}
        />
        <Divider />
        <LinkRow
          icon={<Server size={18} color={palette.muted} />}
          label="Server"
          value={s.relayUrl ? hostOf(s.relayUrl) : 'nessun relay'}
          onPress={() => router.push('/settings/servers')}
        />
        <Divider />
        <LinkRow
          icon={<Activity size={18} color={palette.muted} />}
          label="Diagnostica"
          onPress={() => router.push('/diagnostics')}
        />
        <Divider />
        <ToggleRow
          label="Doppio invio"
          hint="Ogni comando parte su due percorsi insieme; il ricevitore ne esegue uno solo."
          value={s.mirrorCritical}
          onChange={(v) => s.set({ mirrorCritical: v })}
        />
      </Section>

      <Section title="Telecomando">
        <LinkRow
          icon={<FastForward size={18} color={palette.muted} />}
          label="Salti"
          value={s.seekPresets.map(jumpLabel).join(' · ')}
          onPress={() => router.push('/settings/seek')}
        />
        <Divider />
        <ToggleRow label="Vibrazione" value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
        <Divider />
        <ToggleRow
          label="Schermo sempre acceso"
          hint="Utile se tieni il telefono in mano mentre guardi."
          value={s.keepAwake}
          onChange={(v) => s.set({ keepAwake: v })}
        />
      </Section>

      <Text className="text-center text-xs text-muted-foreground">Skipper</Text>
    </ScrollView>
  );
}
