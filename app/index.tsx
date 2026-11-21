import { View, Text, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CameraScreen from './camera';
import { Entrance, PressableScale } from '@/components/motion';

export default function Index() {
  const insets = useSafeAreaInsets();
  const [isFocused, setIsFocused] = useState(true);
  const showDebugButton = process.env.EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON === 'true';

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
      };
    }, []),
  );

  return (
    <View style={styles.container}>
      {isFocused && <CameraScreen />}
      <View style={[styles.inboxOverlay, { top: insets.top + 10 }]}>
        <PressableScale
          style={styles.debugButton}
          haptic="light"
          testID="receipt-inbox"
          accessibilityLabel="Receipt inbox"
          onPress={() => router.push('/inbox')}
        >
          <Text style={styles.debugButtonText}>Inbox</Text>
        </PressableScale>
      </View>
      {showDebugButton && (
        <Entrance delay={120} style={styles.debugOverlay}>
          <PressableScale
            style={styles.debugButton}
            haptic="light"
            onPress={() =>
              router.push({ pathname: '/receipt-details', params: { useMockData: 'true' } })
            }
          >
            <Text style={styles.debugButtonText}>Skip to Receipt</Text>
          </PressableScale>
        </Entrance>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inboxOverlay: { position: 'absolute', left: 16 },
  debugOverlay: { position: 'absolute', top: 60, right: 16, zIndex: 1000 },
  debugButton: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  debugButtonText: { color: '#0B0B0F', fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
});
