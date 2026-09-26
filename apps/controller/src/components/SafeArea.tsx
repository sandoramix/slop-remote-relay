import { styled } from 'nativewind';
import { SafeAreaView as RNSafeAreaView } from 'react-native-safe-area-context';

/**
 * SafeAreaView that understands className.
 *
 * NativeWind only maps className on React Native's own components. On the
 * safe-area-context SafeAreaView it was silently dropped, so "flex-1" never
 * applied, the view had no height, and any flex child inside it collapsed to
 * nothing — the black screen after the splash on onboarding in v0.2.0/v0.2.1.
 * Always import SafeAreaView from here, never from the library directly.
 */
export const SafeAreaView = styled(RNSafeAreaView, { className: 'style' });
