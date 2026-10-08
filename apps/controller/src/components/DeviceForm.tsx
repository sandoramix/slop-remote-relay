import * as Clipboard from 'expo-clipboard';
import { Bluetooth, Copy, Globe, RefreshCw, Search, Smartphone, Wand2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { generatePairCode, pairCodeIsWeak, uuid } from '../lib/crypto';
import { t, useT } from '../lib/i18n';
import { palette } from '../lib/palette';
import { discoverReceivers, type DiscoveredReceiver } from '../lib/transports/discovery';
import { scanReceivers, type ScannedReceiver } from '../lib/transports/ble';
import { type Target, TargetSchema } from '../state/settings';
import { Divider, Field, Section, SmallButton } from './form';

export function emptyTarget(kind: Target['kind'] = 'android'): Target {
  return {
    id: uuid(),
    name: kind === 'browser' ? t('device.defaultBrowser') : t('device.defaultPhone'),
    kind,
    pairCode: generatePairCode(),
    lanHost: null,
    bleDeviceId: null,
  };
}

/**
 * Everything that identifies one receiver. The pair code is the only secret:
 * the HMAC key and the rendezvous room are both derived from it, so the same
 * string typed on the receiver is all the pairing there is.
 */
export function DeviceForm({ value, onChange }: { value: Target; onChange: (target: Target) => void }) {
  const t = useT();
  const [scanning, setScanning] = useState<'lan' | 'ble' | null>(null);
  const [lanFound, setLanFound] = useState<DiscoveredReceiver[] | null>(null);
  const [bleFound, setBleFound] = useState<ScannedReceiver[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const patch = (p: Partial<Target>) => onChange({ ...value, ...p });
  const valid = TargetSchema.safeParse(value);
  const isAndroid = value.kind === 'android';

  const scanLan = async () => {
    setScanning('lan');
    setScanError(null);
    try {
      setLanFound(await discoverReceivers());
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(null);
    }
  };

  const scanBle = async () => {
    setScanning('ble');
    setScanError(null);
    try {
      setBleFound(await scanReceivers());
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(null);
    }
  };

  return (
    <View className="gap-6">
      <Section title={t('form.type')}>
        <View className="flex-row gap-2 p-2">
          <KindOption
            active={isAndroid}
            icon={<Smartphone size={22} color={isAndroid ? palette.primary : palette.muted} />}
            title={t('form.androidTitle')}
            subtitle={t('form.androidSubtitle')}
            onPress={() => patch({ kind: 'android' })}
          />
          <KindOption
            active={!isAndroid}
            icon={<Globe size={22} color={!isAndroid ? palette.primary : palette.muted} />}
            title={t('form.browserTitle')}
            subtitle={t('form.browserSubtitle')}
            onPress={() => patch({ kind: 'browser' })}
          />
        </View>
      </Section>

      <Section
        title={t('form.identity')}
        footer={t('form.identityFooter')}
      >
        <Field
          label={t('form.name')}
          value={value.name}
          onChangeText={(name) => patch({ name })}
          placeholder={t('form.namePlaceholder')}
          autoCapitalize="sentences"
          error={valid.success || value.name.trim() ? null : t('form.nameRequired')}
        />
        <Divider />
        <Field
          label={t('form.pairCode')}
          value={value.pairCode}
          onChangeText={(pairCode) => patch({ pairCode: pairCode.trim() })}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          error={value.pairCode ? null : t('form.codeRequired')}
          hint={
            value.pairCode && pairCodeIsWeak(value.pairCode)
              ? t('form.codeWeak')
              : undefined
          }
          right={
            <View className="flex-row gap-2">
              <IconButton label={t('form.generateCode')} onPress={() => patch({ pairCode: generatePairCode() })}>
                <Wand2 size={18} color={palette.foreground} />
              </IconButton>
              <IconButton label={t('form.copyCode')} onPress={() => void Clipboard.setStringAsync(value.pairCode)}>
                <Copy size={18} color={palette.foreground} />
              </IconButton>
            </View>
          }
        />
      </Section>

      {isAndroid ? (
        <Section
          title={t('form.nearby')}
          footer={t('form.nearbyFooter')}
        >
          <Field
            label={t('form.lanAddress')}
            value={value.lanHost ?? ''}
            onChangeText={(h) => patch({ lanHost: h.trim() || null })}
            placeholder="192.168.1.20"
            keyboardType="numbers-and-punctuation"
            right={
              <IconButton label={t('form.lanSearch')} onPress={scanLan} disabled={scanning !== null}>
                {scanning === 'lan' ? <ActivityIndicator color={palette.foreground} /> : <Search size={18} color={palette.foreground} />}
              </IconButton>
            }
          />
          {lanFound ? (
            <FoundList
              empty={t('form.lanEmpty')}
              items={lanFound.map((r) => ({ key: r.host, title: r.name, subtitle: r.host }))}
              onPick={(host) => {
                patch({ lanHost: host });
                setLanFound(null);
              }}
            />
          ) : null}
          <Divider />
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Bluetooth size={18} color={palette.muted} />
            <View className="flex-1">
              <Text className="text-sm font-medium text-foreground">{t('form.bluetooth')}</Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {value.bleDeviceId ?? t('form.bleNone')}
              </Text>
            </View>
            <SmallButton
              label={scanning === 'ble' ? t('form.bleSearching') : t('form.bleSearch')}
              icon={<RefreshCw size={14} color={palette.foreground} />}
              onPress={scanBle}
              disabled={scanning !== null}
            />
          </View>
          {bleFound ? (
            <FoundList
              empty={t('form.bleEmpty')}
              items={bleFound.map((r) => ({ key: r.id, title: r.name, subtitle: r.rssi != null ? `${r.rssi} dBm` : r.id }))}
              onPick={(id) => {
                patch({ bleDeviceId: id });
                setBleFound(null);
              }}
            />
          ) : null}
          {scanError ? <Text className="px-4 pb-3 text-xs text-destructive">{scanError}</Text> : null}
        </Section>
      ) : null}
    </View>
  );
}

function KindOption({
  active,
  icon,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      className={`flex-1 gap-2 rounded-xl border p-3 ${active ? 'border-primary bg-primary/10' : 'border-transparent bg-secondary'} active:opacity-80`}
    >
      {icon}
      <Text className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{title}</Text>
      <Text className="text-xs text-muted-foreground">{subtitle}</Text>
    </Pressable>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-xl bg-accent active:opacity-70"
    >
      {children}
    </Pressable>
  );
}

function FoundList({
  items,
  empty,
  onPick,
}: {
  items: Array<{ key: string; title: string; subtitle: string }>;
  empty: string;
  onPick: (key: string) => void;
}) {
  if (items.length === 0) return <Text className="px-4 pb-3 text-xs text-muted-foreground">{empty}</Text>;
  return (
    <View className="mx-4 mb-3 overflow-hidden rounded-xl border border-border">
      {items.map((it) => (
        <Pressable key={it.key} onPress={() => onPick(it.key)} className="px-3 py-2.5 active:bg-accent">
          <Text className="text-sm text-foreground">{it.title}</Text>
          <Text className="text-xs text-muted-foreground">{it.subtitle}</Text>
        </Pressable>
      ))}
    </View>
  );
}
