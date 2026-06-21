import { View, Text, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import CameraScreen from './camera';
import { Entrance, PressableScale } from '@/components/motion';

export default function Index() {
  const [isFocused, setIsFocused] = useState(true);
  const showDebugButton = process.env.EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON === 'true';

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => { setIsFocused(false); };
    }, []),
  );

  return (
    <View style={styles.container}>
      {isFocused && <CameraScreen />}
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
  debugOverlay: { position: 'absolute', top: 60, right: 16, zIndex: 1000 },
  debugButton: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  debugButtonText: { color: '#0B0B0F', fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
});
