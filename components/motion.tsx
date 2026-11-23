// components/motion.tsx — shared motion primitives
// Built on React Native's native-driven Animated API (no Reanimated/worklets
// dependency, so it runs without extra Babel config). Two pieces:
//   <Entrance>      — a fade + lift reveal, staggerable via `delay`
//   <PressableScale>— a tappable that springs inward and fires haptics
// Keeping motion in one place is what makes it feel cohesive instead of
// scattered one-off animations.

import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { motion } from '@/utils/theme';

// --- Entrance --------------------------------------------------------------
export function Entrance({
  children,
  delay = 0,
  distance = 12,
  duration = motion.entranceDuration,
  style,
}: {
  children: ReactNode;
  delay?: number;
  /** vertical lift in px; pass 0 for an opacity-only fade (e.g. clipped lists) */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out((t) => Easing.cubic(t)),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, duration]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

// --- PressableScale --------------------------------------------------------
type HapticKind = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'none';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function fireHaptic(kind: HapticKind) {
  switch (kind) {
    case 'none':
      return;
    case 'selection':
      void Haptics.selectionAsync().catch(() => {}); // Haptics are best effort.
      return;
    case 'success':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); // Haptics are best effort.
      return;
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); // Haptics are best effort.
      return;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); // Haptics are best effort.
      return;
    case 'heavy':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); // Haptics are best effort.
      return;
  }
}

export function PressableScale({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  haptic = 'selection',
  scaleTo = motion.pressScale,
  accessibilityLabel,
  accessibilityHint,
  testID,
  hitSlop,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptic?: HapticKind;
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  hitSlop?: number;
}) {
  const [scale] = useState(() => new Animated.Value(1));

  const spring = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      friction: motion.spring.friction,
      tension: motion.spring.tension,
    });

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={hitSlop}
      disabled={disabled}
      onLongPress={onLongPress}
      onPressIn={() => spring(disabled ? 1 : scaleTo).start()}
      onPressOut={() => spring(1).start()}
      onPress={() => {
        if (disabled) return;
        fireHaptic(haptic);
        onPress?.();
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
