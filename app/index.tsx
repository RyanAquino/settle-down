import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import CameraScreen from './camera';

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
        <View style={styles.debugOverlay}>
          <TouchableOpacity
            style={styles.debugButton}
            onPress={() =>
              router.push({ pathname: '/receipt-details', params: { useMockData: 'true' } })
            }
          >
            <Text style={styles.debugButtonText}>Skip to Receipt</Text>
          </TouchableOpacity>
        </View>
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
