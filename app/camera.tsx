import { useCameraPermissions } from 'expo-camera';
import { useState, useRef, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, Alert, AppState, Linking } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CameraSession } from '@/components/camera-session';
import { theme } from '@/utils/theme';
import { Entrance, PressableScale } from '@/components/motion';

export default function CameraScreen() {
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const pickingFromLibrary = useRef(false);
  const params = useLocalSearchParams();

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppState(state);
      if (state === 'active') void refreshPermission().catch(() => {});
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  useEffect(() => {
    if (params.message) Alert.alert('Saved', params.message as string);
    if (params.error) Alert.alert('Error', params.error as string);
  }, [params.message, params.error]);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.permissionWrap]}>
        <Entrance distance={16}>
          <Text style={styles.permissionTitle}>Camera access</Text>
        </Entrance>
        <Entrance delay={80} distance={16}>
          <Text style={styles.permissionBody}>
            Settle Down needs your camera to read receipts.
          </Text>
        </Entrance>
        <Entrance delay={160} distance={16}>
          <PressableScale style={styles.permissionBtn} haptic="medium" onPress={permission.canAskAgain ? requestPermission : () => { void Linking.openSettings(); }}>
            <Text style={styles.permissionBtnText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
          </PressableScale>
        </Entrance>
      </View>
    );
  }

  const pickFromLibrary = async () => {
    if (pickingFromLibrary.current) return;
    pickingFromLibrary.current = true;
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        Alert.alert(
          'Permission required',
          'Settle Down needs access to your photo library.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => { void Linking.openSettings(); } },
          ],
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        router.push({
          pathname: '/loading',
          params: { photoUri: result.assets[0].uri, fromLibrary: 'true' },
        });
      }
    } catch {
      Alert.alert('Error', 'Failed to pick photo from library. Please try again.');
    } finally {
      pickingFromLibrary.current = false;
    }
  };

  return (
    <View style={styles.container}>
      {isFocused && appState === 'active' && (
        <CameraSession onPickFromLibrary={pickFromLibrary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // permission state
  permissionWrap: {
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: theme.ink,
    marginBottom: 8,
  },
  permissionBody: {
    fontSize: 15,
    color: theme.inkMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  permissionBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: theme.ink,
  },
  permissionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
