import { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Alert, PanResponder, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/motion';

const ZOOM_STEP = 0.05;
// Expo uses normalized zoom, not magnification. A doubling of finger spacing
// moves a small portion of that range so high-zoom devices remain controllable.
const PINCH_SENSITIVITY = 0.15;

function pinchDistance(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length !== 2) return null;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

// Mount a fresh session whenever the screen becomes active. This releases the
// camera on both platforms and resets readiness and zoom when returning.
export function CameraSession({ onPickFromLibrary }: { onPickFromLibrary: () => Promise<void> }) {
  const cameraRef = useRef<CameraView>(null);
  const mounted = useRef(true);
  const ready = useRef(false);
  const capturing = useRef(false);
  const zoomRef = useRef(0);
  const pinchRef = useRef<number | null>(null);
  const [zoom, setZoom] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ready.current = false; };
  }, []);

  const changeZoom = (value: number) => {
    if (!ready.current || capturing.current) return;
    zoomRef.current = Math.min(1, Math.max(0, value));
    setZoom(zoomRef.current);
  };

  // PanResponder stores these callbacks; refs are read only when a gesture fires.
  // eslint-disable-next-line react-hooks/refs
  const [pinch] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => ready.current && !capturing.current && event.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (event) => ready.current && !capturing.current && event.nativeEvent.touches.length === 2,
    onPanResponderGrant: (event) => { pinchRef.current = pinchDistance(event); },
    onPanResponderMove: (event) => {
      const distance = pinchDistance(event);
      const previous = pinchRef.current;
      pinchRef.current = distance;
      if (distance && previous && ready.current && !capturing.current) {
        zoomRef.current = Math.min(1, Math.max(0,
          zoomRef.current + Math.log2(distance / previous) * PINCH_SENSITIVITY));
        setZoom(zoomRef.current);
      }
    },
    onPanResponderRelease: () => { pinchRef.current = null; },
    onPanResponderTerminate: () => { pinchRef.current = null; },
  }));

  const takePicture = async () => {
    if (!cameraRef.current || !ready.current || capturing.current) return;
    capturing.current = true;
    setIsCapturing(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!mounted.current) return;
      if (!photo?.uri) throw new Error('Camera returned no photo');
      // Keep capture locked until navigation unmounts this session.
      router.push({ pathname: '/loading', params: { photoUri: photo.uri } });
    } catch {
      if (!mounted.current) return;
      capturing.current = false;
      setIsCapturing(false);
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const controlsDisabled = !isReady || isCapturing;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.preview} {...pinch.panHandlers} testID="camera-preview">
        <CameraView
          key={cameraKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          pictureSize="High"
          videoQuality="4:3"
          ratio="4:3"
          // Expo's "off" means continuous autofocus; "on" focuses once and locks.
          autofocus="off"
          // Expo web drops a literal zero constraint. Epsilon rounds to the
          // minimum hardware zoom while still sending the reset to the track.
          zoom={Platform.OS === 'web' && zoom === 0 ? Number.EPSILON : zoom}
          // Preserve the existing orientation and capture behavior.
          responsiveOrientationWhenOrientationLocked
          animateShutter={false}
          onCameraReady={() => {
            if (!mounted.current) return;
            ready.current = true;
            setIsReady(true);
            setCameraError(false);
          }}
          onMountError={() => {
            ready.current = false;
            setIsReady(false);
            setCameraError(true);
          }}
        />
        <View pointerEvents="none" style={[styles.topHint, { top: insets.top + 12 }]}>
          <Text style={styles.topHintText}>Point at a receipt</Text>
        </View>
        {cameraError && (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>Unable to start the camera</Text>
            <PressableScale
              style={styles.retryButton}
              onPress={() => { setCameraError(false); setCameraKey((key) => key + 1); }}
              accessibilityLabel="Retry camera"
            >
              <Text style={styles.controlText}>Try again</Text>
            </PressableScale>
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.zoomControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            disabled={controlsDisabled || zoom === 0}
            onPress={() => changeZoom(zoomRef.current - ZOOM_STEP)}
            style={[styles.zoomButton, (controlsDisabled || zoom === 0) && styles.disabled]}
          >
            <Text style={styles.zoomSymbol}>−</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            disabled={controlsDisabled || zoom === 0}
            onPress={() => changeZoom(0)}
            style={[styles.resetButton, (controlsDisabled || zoom === 0) && styles.disabled]}
          >
            <Text style={styles.controlText}>Reset</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            disabled={controlsDisabled || zoom === 1}
            onPress={() => changeZoom(zoomRef.current + ZOOM_STEP)}
            style={[styles.zoomButton, (controlsDisabled || zoom === 1) && styles.disabled]}
          >
            <Text style={styles.zoomSymbol}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.zoomHint}>Pinch to zoom</Text>
        <View style={styles.captureRow}>
          <PressableScale style={[styles.sideButton, isCapturing && styles.disabled]} disabled={isCapturing}
            onPress={onPickFromLibrary} accessibilityLabel="Pick from library">
            <View style={styles.libraryIcon}>
              <View style={styles.libraryBack} />
              <View style={styles.libraryFront} />
            </View>
            <Text style={styles.sideLabel}>Library</Text>
          </PressableScale>
          <PressableScale
            style={[styles.shutter, controlsDisabled && styles.disabled]}
            disabled={controlsDisabled}
            scaleTo={0.9}
            haptic="none"
            onPress={takePicture}
            accessibilityLabel="Capture receipt"
          >
            <View style={styles.shutterInner} />
          </PressableScale>
          <View style={styles.sideButton} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1, overflow: 'hidden', ...Platform.select({ web: { touchAction: 'none' } }) },
  topHint: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  topHintText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  bottomBar: { paddingTop: 16, paddingHorizontal: 32, alignItems: 'center', backgroundColor: '#000' },
  zoomControls: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: '#242424', padding: 2, gap: 6 },
  zoomButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  resetButton: { minWidth: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomSymbol: { color: '#fff', fontSize: 26, fontWeight: '400' },
  controlText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  zoomHint: { color: '#aaa', fontSize: 12, marginTop: 8, marginBottom: 18 },
  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  sideButton: { width: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  sideLabel: { color: '#ddd', fontSize: 11, marginTop: 4, fontWeight: '500' },
  libraryIcon: { width: 32, height: 28 },
  libraryBack: { position: 'absolute', top: 0, left: 4, width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: '#999' },
  libraryFront: { position: 'absolute', bottom: 0, right: 2, width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: '#fff', backgroundColor: '#242424' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  disabled: { opacity: 0.35 },
  errorPanel: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#161616' },
  errorText: { color: '#fff', fontSize: 16, marginBottom: 16 },
  retryButton: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#333', borderRadius: 24 },
});
