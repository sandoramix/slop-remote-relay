import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '../../lib/palette';
import { useCommandState } from './useCommand';

/**
 * The result of the last command: what happened, which layer did it, over
 * which path and how fast. Errors stay longer than successes because they are
 * the ones worth reading.
 */
export function FeedbackToast() {
  const feedback = useCommandState((s) => s.feedback);
  const dismiss = useCommandState((s) => s.dismiss);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(dismiss, feedback.tone === 'ok' ? 2200 : 5000);
    return () => clearTimeout(timer);
  }, [feedback, dismiss]);

  if (!feedback) return null;
  const ok = feedback.tone === 'ok';

  return (
    <Animated.View
      key={feedback.id}
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(160)}
      style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={dismiss}
        accessibilityLiveRegion="polite"
        className={`flex-row items-center gap-3 rounded-2xl border bg-popover px-4 py-3 ${ok ? 'border-success/40' : 'border-destructive/50'}`}
      >
        {ok ? (
          <CircleCheck size={20} color={palette.success} />
        ) : (
          <CircleAlert size={20} color={palette.destructive} />
        )}
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {feedback.title}
          </Text>
          {feedback.detail ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={2}>
              {feedback.detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
