import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, Alert, Animated, Easing } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { theme } from '@/utils/theme';
import { Entrance, PressableScale } from '@/components/motion';

export default function CameraScreen() {
  const [facing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  // Slow breathing pulse on the framing guides — signals "live / ready to scan"
  // without the nervous energy of a fast blink.
  const guidePulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(guidePulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(guidePulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [guidePulse]);
  const guideOpacity = guidePulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

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
          <PressableScale style={styles.permissionBtn} haptic="medium" onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Allow camera</Text>
          </PressableScale>
        </Entrance>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        skipProcessing: true,
        shutterSound: false,
      });
      if (photo?.uri) {
        router.push({ pathname: '/loading', params: { photoUri: photo.uri } });
      }
    } catch {
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        Alert.alert(
          'Permission required',
          'Settle Down needs access to your photo library.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => ImagePicker.requestMediaLibraryPermissionsAsync() },
          ],
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'Images',
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
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="picture"
        pictureSize="High"
        videoQuality="4:3"
        ratio="4:3"
      />

      {/* Top hint — subtle */}
      <Entrance delay={120} distance={-8} style={[styles.topHint, { top: insets.top + 12 }]}>
        <Text style={styles.topHintText}>Point at a receipt</Text>
      </Entrance>

      {/* Framing guides — breathe gently to read as "live" */}
      <Animated.View pointerEvents="none" style={[styles.guides, { opacity: guideOpacity }]}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </Animated.View>

      {/* Bottom controls */}
      <Entrance delay={80} style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 24) + 8 }]}>
        <PressableScale style={styles.sideBtn} onPress={pickFromLibrary} accessibilityLabel="Pick from library">
          <View style={styles.sideBtnIcon}>
            <View style={styles.libraryBack} />
            <View style={styles.libraryFront} />
          </View>
          <Text style={styles.sideBtnLabel}>Library</Text>
        </PressableScale>

        <PressableScale
          style={styles.shutter}
          scaleTo={0.9}
          haptic="none"
          onPress={takePicture}
          accessibilityLabel="Capture receipt"
        >
          <View style={styles.shutterInner} />
        </PressableScale>

        <View style={styles.sideBtn}>
          {/* placeholder spacer so shutter stays centered */}
        </View>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  topHint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topHintText: {
    color: '#fff',
    fontSize: 13,
    letterSpacing: 0.2,
    fontWeight: '500',
  },

  guides: {
    position: 'absolute',
    top: '18%',
    bottom: '28%',
    left: 28,
    right: 28,
  },
  corner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 4 },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 18,
    paddingHorizontal: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  sideBtn: {
    width: 72,
    alignItems: 'center',
  },
  sideBtnIcon: {
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  libraryBack: {
    position: 'absolute',
    top: 0,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  libraryFront: {
    position: 'absolute',
    bottom: 0,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  sideBtnLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    letterSpacing: 0.3,
    fontWeight: '500',
  },

  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },

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
