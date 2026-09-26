import { Text, View } from 'react-native';
import { palette } from '../lib/palette';

/** Health of one transport: green up, amber dialling, red down. */
export function StateDot({ state, active }: { state: string; active: boolean }) {
  const color =
    state === 'connected' ? palette.success : state === 'connecting' ? palette.warning : palette.destructive;
  return (
    <View className="flex-row items-center gap-1">
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      {active ? <Text className="text-[10px] font-bold uppercase tracking-wider text-primary">in uso</Text> : null}
    </View>
  );
}
