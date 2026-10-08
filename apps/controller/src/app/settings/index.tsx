import type { TransportId } from '@relay/protocol';
import { router } from 'expo-router';
import { Activity, Check, FastForward, Plus, Route, Server } from 'lucide-react-native';
import { Fragment } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { Divider, LinkRow, Section, ToggleRow } from '../../components/form';
import { UpdatesSection } from '../../components/UpdatesSection';
import { KindIcon } from '../../components/remote/TargetSwitcher';
import { jumpLabel } from '../../lib/format';
import { LANGUAGE_NAMES, useT } from '../../lib/i18n';
import { palette } from '../../lib/palette';
import { TRANSPORTS } from '../../lib/transports/registry';
import { isEnabled, LANGUAGES, normalizeOrder, useSettings } from '../../state/settings';

/** Host of a ws/wss/http URL, without throwing on a half-typed one. */
const hostOf = (raw: string) => raw.replace(/^[a-z]+:\/\//i, '').split('/')[0] || raw;

export default function SettingsScreen() {
  const t = useT();
  const s = useSettings();
  const order = normalizeOrder(s.transportOrder).filter((id) => isEnabled(s, id));
  const first = order[0] ? TRANSPORTS[order[0] as TransportId].label : t('settings.none');

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 pb-12 pt-2">
      <Section title={t('settings.devices')}>
        {s.targets.map((d, i) => (
          <Fragment key={d.id}>
            {i > 0 ? <Divider /> : null}
            <LinkRow
              icon={<KindIcon kind={d.kind} color={palette.muted} />}
              label={d.name}
              value={d.id === s.activeTargetId ? t('settings.inUse') : undefined}
              onPress={() => router.push(`/settings/device/${d.id}`)}
            />
          </Fragment>
        ))}
        <Divider />
        <LinkRow
          icon={<Plus size={18} color={palette.primary} />}
          label={t('settings.addDevice')}
          onPress={() => router.push('/settings/device/new')}
        />
      </Section>

      <Section title={t('settings.connection')}>
        <LinkRow
          icon={<Route size={18} color={palette.muted} />}
          label={t('settings.paths')}
          value={t('settings.pathsFirst', { name: first })}
          onPress={() => router.push('/settings/transports')}
        />
        <Divider />
        <LinkRow
          icon={<Server size={18} color={palette.muted} />}
          label={t('settings.servers')}
          value={s.relayUrl ? hostOf(s.relayUrl) : t('settings.noRelay')}
          onPress={() => router.push('/settings/servers')}
        />
        <Divider />
        <LinkRow
          icon={<Activity size={18} color={palette.muted} />}
          label={t('settings.diagnostics')}
          onPress={() => router.push('/diagnostics')}
        />
        <Divider />
        <ToggleRow
          label={t('settings.mirror')}
          hint={t('settings.mirrorHint')}
          value={s.mirrorCritical}
          onChange={(v) => s.set({ mirrorCritical: v })}
        />
      </Section>

      <Section title={t('settings.remote')}>
        <LinkRow
          icon={<FastForward size={18} color={palette.muted} />}
          label={t('settings.jumps')}
          value={s.seekPresets.map(jumpLabel).join(' · ')}
          onPress={() => router.push('/settings/seek')}
        />
        <Divider />
        <ToggleRow label={t('settings.haptics')} value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
        <Divider />
        <ToggleRow
          label={t('settings.keepAwake')}
          hint={t('settings.keepAwakeHint')}
          value={s.keepAwake}
          onChange={(v) => s.set({ keepAwake: v })}
        />
      </Section>

      <Section title={t('settings.language')}>
        {LANGUAGES.map((code, i) => (
          <Fragment key={code}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              onPress={() => s.set({ language: code })}
              accessibilityRole="radio"
              accessibilityState={{ selected: s.language === code }}
              className="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent"
            >
              <Text className="flex-1 text-base text-foreground">{LANGUAGE_NAMES[code]}</Text>
              {s.language === code ? <Check size={18} color={palette.primary} /> : null}
            </Pressable>
          </Fragment>
        ))}
      </Section>

      <UpdatesSection />


      <Text className="text-center text-xs text-muted-foreground">{t('settings.appName')}</Text>
    </ScrollView>
  );
}
