// components/motion.tsx — shared motion primitives
// Built on React Native's native-driven Animated API (no Reanimated/worklets
// dependency, so it runs without extra Babel config). Two pieces:
//   <Entrance>      — a fade + lift reveal, staggerable via `delay`
//   <PressableScale>— a tappable that springs inward and fires haptics
// Keeping motion in one place is what makes it feel cohesive instead of
// scattered one-off animations.

import { useEffect, useRef, type ReactNode } from 'react';
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
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
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
      Haptics.selectionAsync();
      return;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'heavy':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
  }
}

export function PressableScale({
  children,
  onPress,
  style,
  disabled = false,
  haptic = 'selection',
  scaleTo = motion.pressScale,
  accessibilityLabel,
  hitSlop,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptic?: HapticKind;
  scaleTo?: number;
  accessibilityLabel?: string;
  hitSlop?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

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
      hitSlop={hitSlop}
      disabled={disabled}
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