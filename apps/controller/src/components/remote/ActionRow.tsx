import { Maximize, Minimize } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { palette } from '../../lib/palette';
import { useSession } from '../../state/session';
import { useCommand, useCommandState } from './useCommand';

/**
 * Fullscreen, as a toggle that shows which way it will go. When the receiver
 * can tell (status.fullscreen) the label follows it; when it cannot, the key
 * says "Schermo intero" and the receiver toggles on its own reading.
 */
export function ActionRow() {
  const run = useCommand();
  const busy = useCommandState((s) => s.busy);
  const fullscreen = useSession((s) => s.status?.fullscreen ?? null);

  const exiting = fullscreen === true;
  const Icon = exiting ? Minimize : Maximize;

  return (
    <View className="flex-row gap-3">
      <Pressable
        onPress={() => void run('fs', (c) => (exiting ? c.exitFullscreen() : c.fullscreen(true)))}
        onLongPress={() => void run('fs', (c) => c.exitFullscreen())}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel={exiting ? 'Esci dallo schermo intero' : 'Schermo intero'}
        accessibilityHint="Tieni premuto per uscire comunque"
        className="h-16 flex-1 flex-row items-center justify-center gap-3 rounded-2xl bg-primary active:opacity-80"
      >
        {busy === 'fs' ? (
          <ActivityIndicator color={palette.primaryInk} />
        ) : (
          <>
            <Icon size={22} color={palette.primaryInk} />
            <Text className="text-lg font-bold text-primary-foreground">
              {exiting ? 'Esci da schermo intero' : 'Schermo intero'}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}
