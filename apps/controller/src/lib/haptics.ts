import * as Haptics from 'expo-haptics';
import { useSettings } from '../state/settings';

/** Haptics that respect the user's switch. Fire-and-forget: never awaited. */
export const haptic = {
  tap: () => {
    if (useSettings.getState().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  heavy: () => {
    if (useSettings.getState().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  success: () => {
    if (useSettings.getState().haptics)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error: () => {
    if (useSettings.getState().haptics)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
};
