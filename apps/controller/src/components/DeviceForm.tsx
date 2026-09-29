import * as Clipboard from 'expo-clipboard';
import { Bluetooth, Copy, Globe, RefreshCw, Search, Smartphone, Wand2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { generatePairCode, pairCodeIsWeak, uuid } from '../lib/crypto';
import { palette } from '../lib/palette';
import { discoverReceivers, type DiscoveredReceiver } from '../lib/transports/discovery';
import { scanReceivers, type ScannedReceiver } from '../lib/transports/ble';
import { type Target, TargetSchema } from '../state/settings';
import { Divider, Field, Section, SmallButton } from './form';

export function emptyTarget(kind: Target['kind'] = 'android'): Target {
  return {
    id: uuid(),
    name: kind === 'browser' ? 'Browser' : 'Telefono',
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
export function DeviceForm({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
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
      <Section title="Tipo">
        <View className="flex-row gap-2 p-2">
          <KindOption
            active={isAndroid}
            icon={<Smartphone size={22} color={isAndroid ? palette.primary : palette.muted} />}
            title="Telefono Android"
            subtitle="App Skipper Screen"
            onPress={() => patch({ kind: 'android' })}
          />
          <KindOption
            active={!isAndroid}
            icon={<Globe size={22} color={!isAndroid ? palette.primary : palette.muted} />}
            title="Browser"
            subtitle="Estensione Chrome/Brave"
            onPress={() => patch({ kind: 'browser' })}
          />
        </View>
      </Section>

      <Section
        title="Identità"
        footer="Inserisci lo stesso codice nel ricevitore. Da questo codice derivano la chiave di firma e la stanza sul relay: tienilo lungo."
      >
        <Field
          label="Nome"
          value={value.name}
          onChangeText={(name) => patch({ name })}
          placeholder="es. Telefono in salotto"
          autoCapitalize="sentences"
          error={valid.success || value.name.trim() ? null : 'Serve un nome'}
        />
        <Divider />
        <Field
          label="Codice di accoppiamento"
          value={value.pairCode}
          onChangeText={(pairCode) => patch({ pairCode: pairCode.trim() })}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          error={value.pairCode ? null : 'Serve un codice'}
          hint={
            value.pairCode && pairCodeIsWeak(value.pairCode)
              ? 'Codice corto: chi gestisce il relay o un broker MQTT pubblico potrebbe indovinarlo.'
              : undefined
          }
          right={
            <View className="flex-row gap-2">
              <IconButton label="Genera nuovo codice" onPress={() => patch({ pairCode: generatePairCode() })}>
                <Wand2 size={18} color={palette.foreground} />
              </IconButton>
              <IconButton label="Copia codice" onPress={() => void Clipboard.setStringAsync(value.pairCode)}>
                <Copy size={18} color={palette.foreground} />
              </IconButton>
            </View>
          }
        />
      </Section>

      {isAndroid ? (
        <Section
          title="Vicino a te"
          footer="Facoltativi. Wi-Fi locale e Bluetooth funzionano senza internet; il resto passa dai server."
        >
          <Field
            label="Indirizzo sulla rete locale"
            value={value.lanHost ?? ''}
            onChangeText={(h) => patch({ lanHost: h.trim() || null })}
            placeholder="192.168.1.20"
            keyboardType="numbers-and-punctuation"
            right={
              <IconButton label="Cerca sulla rete" onPress={scanLan} disabled={scanning !== null}>
                {scanning === 'lan' ? <ActivityIndicator color={palette.foreground} /> : <Search size={18} color={palette.foreground} />}
              </IconButton>
            }
          />
          {lanFound ? (
            <FoundList
              empty="Nessun ricevitore trovato su questa rete"
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
              <Text className="text-sm font-medium text-foreground">Bluetooth</Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {value.bleDeviceId ?? 'Nessun ricevitore associato'}
              </Text>
            </View>
            <SmallButton
              label={scanning === 'ble' ? 'Ricerca…' : 'Cerca'}
              icon={<RefreshCw size={14} color={palette.foreground} />}
              onPress={scanBle}
              disabled={scanning !== null}
            />
          </View>
          {bleFound ? (
            <FoundList
              empty="Nessun ricevitore Bluetooth nelle vicinanze"
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
