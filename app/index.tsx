import { prepareScan } from '@/utils/scan-request';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import CameraScreen from './camera';
import { createPhotoDraft } from '@/utils/receipt-inbox';
import { Entrance, PressableScale } from '@/components/motion';

async function importVerificationPhoto(mode: 'offline' | 'interrupted') {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!result.canceled) {
      const photoUri = result.assets[0].uri;
      if (mode === 'interrupted') {
        // Recreate the disk state immediately before a completed import is published.
        const draft = await createPhotoDraft(photoUri);
        new Directory(Paths.document, 'receipt-inbox', draft.id).rename('import-' + draft.id);
        router.push('/inbox');
        return;
      }
      router.push(prepareScan({ photoUri, fromLibrary: true, verifyOfflineImport: true }));
    }
  } catch {
    Alert.alert('Error', 'Failed to pick photo from library. Please try again.');
  }
}

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
      {Constants.expoConfig?.extra?.verifyOfflineImport === true && (
        <View style={[styles.inboxOverlay, styles.verificationControls, { top: insets.top + 56 }]}>
          {Constants.expoConfig?.extra?.verifyMissingBackend === true && (
            <PressableScale
              style={styles.debugButton}
              testID="verify-missing-backend"
              accessibilityLabel="Open receipt without backend"
              onPress={() =>
                router.push({
                  pathname: '/receipt-details',
                  params: { useMockData: 'true', verifyMissingBackend: 'true' },
                })
              }
            >
              <Text style={styles.debugButtonText}>Open receipt without backend</Text>
            </PressableScale>
          )}
          <PressableScale
            style={styles.debugButton}
            testID="verify-import-offline"
            accessibilityLabel="Import offline photo"
            onPress={() => void importVerificationPhoto('offline')}
          >
            <Text style={styles.debugButtonText}>Import offline photo</Text>
          </PressableScale>
          <PressableScale
            style={styles.debugButton}
            testID="verify-expired-scan"
            accessibilityLabel="Open expired scan"
            onPress={() => router.push('/loading')}
          >
            <Text style={styles.debugButtonText}>Open expired scan</Text>
          </PressableScale>
          <PressableScale
            style={styles.debugButton}
            testID="verify-interrupted-import"
            accessibilityLabel="Recover interrupted import"
            onPress={() => void importVerificationPhoto('interrupted')}
          >
            <Text style={styles.debugButtonText}>Recover interrupted import</Text>
          </PressableScale>
          <PressableScale
            style={styles.debugButton}
            testID="verify-missing-capture"
            accessibilityLabel="Try missing capture"
            onPress={() =>
              router.push(
                prepareScan({
                  // No file is created here, so the normal draft copy fails.
                  photoUri: new File(Paths.cache, 'verify-missing-capture.jpg').uri,
                  verifyOfflineImport: true,
                }),
              )
            }
          >
            <Text style={styles.debugButtonText}>Try missing capture</Text>
          </PressableScale>
        </View>
      )}
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
  verificationControls: { gap: 8, alignItems: 'flex-start' },
  debugOverlay: { position: 'absolute', top: 60, right: 16, zIndex: 1000 },
  debugButton: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  debugButtonText: { color: '#0B0B0F', fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
});
