import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { palette } from '../lib/palette';

/**
 * Keeps inputs above the keyboard on iOS; a plain full-height view on Android,
 * where the window resizes for the keyboard on its own.
 *
 * Styled with `style` so it does not depend on NativeWind picking up the
 * component. It must sit inside a SafeAreaView from ./SafeArea, which has a
 * real height; see the note there.
 */
export function KeyboardSafe({ children }: { children: ReactNode }) {
  const style = { flex: 1, backgroundColor: palette.background };
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={style} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  ) : (
    <View style={style}>{children}</View>
  );
}
