import { Redirect, router } from 'expo-router';
import { Settings2 } from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionRow } from '../components/remote/ActionRow';
import { ConnectionChip } from '../components/remote/ConnectionChip';
import { FeedbackToast } from '../components/remote/FeedbackToast';
import { NowPlaying } from '../components/remote/NowPlaying';
import { SeekPad } from '../components/remote/SeekPad';
import { TargetSwitcher } from '../components/remote/TargetSwitcher';
import { palette } from '../lib/palette';
import { useSettings } from '../state/settings';

/**
 * The remote. Built for a dark room and one thumb: what is playing up top,
 * the jump keys in the middle where the thumb rests, fullscreen at the bottom.
 */
export default function Remote() {
  const hydrated = useSettings((s) => s.hydrated);
  const hasTargets = useSettings((s) => s.targets.length > 0);

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }
  if (!hasTargets) return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <ScrollView contentContainerClassName="gap-5 px-4 pb-28 pt-2">
        <View className="flex-row items-center justify-between">
          <TargetSwitcher />
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Impostazioni"
            hitSlop={10}
            className="h-10 w-10 items-center justify-center rounded-full bg-card active:opacity-70"
          >
            <Settings2 size={20} color={palette.foreground} />
          </Pressable>
        </View>
        <ConnectionChip />
        <NowPlaying />
        <SeekPad />
        <ActionRow />
      </ScrollView>
      <FeedbackToast />
    </SafeAreaView>
  );
}
