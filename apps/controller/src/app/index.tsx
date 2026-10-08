import { router } from 'expo-router';
import { Settings2 } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from '../components/SafeArea';
import { ActionRow } from '../components/remote/ActionRow';
import { ConnectionChip } from '../components/remote/ConnectionChip';
import { EpisodeNav } from '../components/remote/EpisodeNav';
import { FeedbackToast } from '../components/remote/FeedbackToast';
import { NowPlaying } from '../components/remote/NowPlaying';
import { SeekPad } from '../components/remote/SeekPad';
import { TargetSwitcher } from '../components/remote/TargetSwitcher';
import { UpdateBanner, UpdateDot } from '../components/UpdateBanner';
import { useT } from '../lib/i18n';
import { palette } from '../lib/palette';
import { useNewerRelease } from '../state/update';

/**
 * The remote. Built for a dark room and one thumb: what is playing up top,
 * the jump keys in the middle where the thumb rests, fullscreen at the bottom.
 */
export default function Remote() {
  const t = useT();
  const updateAvailable = useNewerRelease() !== null;
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <ScrollView contentContainerClassName="gap-5 px-4 pb-28 pt-2">
        <View className="flex-row items-center justify-between">
          <TargetSwitcher />
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel={t('remote.settings')}
            hitSlop={10}
            className="h-10 w-10 items-center justify-center rounded-full bg-card active:opacity-70"
          >
            <Settings2 size={20} color={palette.foreground} />
            {updateAvailable ? <UpdateDot className="absolute right-1 top-1" /> : null}
          </Pressable>
        </View>
        <UpdateBanner />
        <ConnectionChip />
        <NowPlaying />
        <SeekPad />
        <EpisodeNav />
        <ActionRow />
      </ScrollView>
      <FeedbackToast />
    </SafeAreaView>
  );
}
