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
      return () => {
        setIsFocused(false);
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      {isFocused && <CameraScreen />}
      {showDebugButton && (
        <View style={styles.debugOverlay}>
          <TouchableOpacity
            style={styles.debugButton}
            onPress={() => router.push('/receipt-details')}
          >
            <Text style={styles.debugButtonText}>Skip to Receipt Details</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  debugOverlay: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 1000,
  },
  debugButton: {
    backgroundColor: 'rgba(0, 122, 255, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  debugButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
