import { View, Text, StyleSheet, Image, Animated, Easing } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import * as MediaLibrary from 'expo-media-library';
import { theme, type } from '@/utils/theme';
import { Entrance } from '@/components/motion';

type StepState = 'pending' | 'active' | 'done';

export default function LoadingScreen() {
  const params = useLocalSearchParams();
  const photoUri = params.photoUri as string;
  const fromLibrary = params.fromLibrary === 'true';
  const [isOffline, setIsOffline] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Reading receipt');
  const [statusDetail, setStatusDetail] = useState('Extracting items and amounts');
  const [steps, setSteps] = useState<{ label: string; state: StepState }[]>([
    { label: 'Capture', state: 'done' },
    { label: 'Read', state: 'active' },
    { label: 'Assign', state: 'pending' },
  ]);

  // scanning beam animation — sweeps top to bottom and back
  const beam = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isOffline) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beam, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(beam, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beam, isOffline]);

  // advance "Read" → "Assign" on a timer so the user sees motion
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isOffline) return;
    tickRef.current = setTimeout(() => {
      setSteps((s) =>
        s.map((st, i) => (i === 1 ? { ...st, state: 'done' } : i === 2 ? { ...st, state: 'active' } : st)),
      );
    }, 1400);
    return () => {
      if (tickRef.current) clearTimeout(tickRef.current);
    };
  }, [isOffline]);

  const savePhotoAsFallback = useCallback(
    async (photoUri: string) => {
      try {
        if (!fromLibrary) {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') {
            await MediaLibrary.saveToLibraryAsync(photoUri);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            router.replace({
              pathname: '/',
              params: { message: 'Upload failed. Photo saved to your photo library.' },
            });
            return;
          }
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        router.replace({ pathname: '/', params: { error: 'Upload failed. Please try again.' } });
      } catch {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        router.replace({ pathname: '/', params: { error: 'Upload failed. Unable to save photo.' } });
      }
    },
    [fromLibrary],
  );

  const uploadPhotoWithRetry = useCallback(
    async (photoUri: string, attempt = 1, maxAttempts = 3): Promise<void> => {
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
      const uploadUrl = `${apiBaseUrl}/api/v1/receipts/receipt-items/`;
      let response: Response | undefined;
      try {
        // Guard: on remote EAS builds the gitignored .env isn't present at bundle time,
        // so EXPO_PUBLIC_API_BASE_URL can be undefined. Fail loudly instead of silently
        // fetching `undefined/api/...` and burying it in the retry/fallback path.
        if (!apiBaseUrl) {
          throw new Error('EXPO_PUBLIC_API_BASE_URL is undefined in this build (env not inlined at bundle time).');
        }

        const formData = new FormData();
        formData.append('file', { uri: photoUri, type: 'image/jpeg', name: 'receipt.jpg' } as any);

        const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
        // Do NOT set 'Content-Type' for multipart/form-data — fetch must set it itself so
        // it can append the required `boundary`. Hardcoding it produces a body the server
        // can't parse.
        const headers: { [key: string]: string } = {
          'ngrok-skip-browser-warning': 'true',
        };
        if (authToken) headers.Authorization = `Bearer ${authToken}`;

        if (attempt > 1) {
          setStatusMessage(`Retrying · attempt ${attempt} of ${maxAttempts}`);
          setStatusDetail('Network took a pause. Hang tight.');
        }

        console.log(`[upload] attempt ${attempt}/${maxAttempts} → ${uploadUrl} (auth=${!!authToken})`);
        response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
          headers,
        });
        console.log(`[upload] response status=${response.status} ok=${response.ok}`);

        if (response.ok) {
          const data = await response.json();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace({ pathname: '/receipt-details', params: { data: JSON.stringify(data) } });
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      } catch (err) {
        const e = err as Error;
        console.warn(
          `[upload] FAILED attempt ${attempt}/${maxAttempts} name=${e?.name} message=${e?.message} status=${response?.status ?? 'no-response'} url=${uploadUrl}`,
        );
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          setStatusMessage(`Retrying in ${delay / 1000}s`);
          setStatusDetail('We\u2019ll try a couple more times before giving up.');
          await new Promise((r) => setTimeout(r, delay));
          return uploadPhotoWithRetry(photoUri, attempt + 1, maxAttempts);
        }
        await savePhotoAsFallback(photoUri);
      }
    },
    [savePhotoAsFallback],
  );

  const uploadPhoto = useCallback(async (uri: string) => uploadPhotoWithRetry(uri), [uploadPhotoWithRetry]);

  const handleLibraryPhotoOffline = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setTimeout(() => {
        router.replace({
          pathname: '/',
          params: { message: 'Internet connection required to process photos from your library.' },
        });
      }, 1800);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({ pathname: '/', params: { error: 'Unable to process photo.' } });
    }
  }, []);

  const saveCameraPhotoToLibrary = useCallback(async (photoUri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') throw new Error('Media library permission denied');
      await MediaLibrary.saveToLibraryAsync(photoUri);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        router.replace({ pathname: '/', params: { message: 'Photo saved to your photo library.' } });
      }, 1800);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({ pathname: '/', params: { error: 'Failed to save photo to library.' } });
    }
  }, []);

  const handleOfflinePhoto = useCallback(
    async (photoUri: string) => {
      if (fromLibrary) await handleLibraryPhotoOffline();
      else await saveCameraPhotoToLibrary(photoUri);
    },
    [fromLibrary, handleLibraryPhotoOffline, saveCameraPhotoToLibrary],
  );

  const checkConnectivityAndProcess = useCallback(
    async (uri: string) => {
      try {
        const netInfoState = await NetInfo.fetch();
        console.log(
          `[netinfo] isConnected=${netInfoState.isConnected} type=${netInfoState.type} isInternetReachable=${netInfoState.isInternetReachable}`,
        );
        // Only an explicit `false` means offline. A strict `=== true` check treats an
        // unknown (`null`) reading as offline and routes to the save-photo path without
        // ever attempting the upload — a silent false-negative.
        const isConnected = netInfoState.isConnected !== false;
        if (isConnected) {
          await uploadPhoto(uri);
        } else {
          setIsOffline(true);
          setStatusMessage('You\u2019re offline');
          setStatusDetail(
            fromLibrary
              ? 'Come back when you\u2019re online to scan this one.'
              : 'Saving the photo. We\u2019ll process it next time you\u2019re online.',
          );
          await handleOfflinePhoto(uri);
        }
      } catch {
        setIsOffline(true);
        setStatusMessage('Network check failed');
        setStatusDetail('Falling back to offline mode.');
        await handleOfflinePhoto(uri);
      }
    },
    [uploadPhoto, handleOfflinePhoto, fromLibrary],
  );

  useEffect(() => {
    if (photoUri) checkConnectivityAndProcess(photoUri);
  }, [photoUri, checkConnectivityAndProcess]);

  // beam translateY: 0 → photoHeight, within the card
  const PHOTO_H = 260;
  const beamY = beam.interpolate({ inputRange: [0, 1], outputRange: [0, PHOTO_H - 2] });
  const beamOpacity = isOffline ? 0 : 1;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Photo card — polaroid style with scan beam */}
        <Entrance distance={18} style={[styles.photoCard, { height: PHOTO_H }]}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]} />
          )}
          {/* scan beam overlay */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.beam,
              {
                opacity: beamOpacity,
                transform: [{ translateY: beamY }],
              },
            ]}
          />
          {/* subtle top tint that follows the beam */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.beamTint,
              {
                opacity: beamOpacity,
                transform: [{ translateY: beamY }],
              },
            ]}
          />
        </Entrance>

        <Entrance delay={120}>
          <Text style={styles.title}>{statusMessage}</Text>
        </Entrance>
        <Entrance delay={180}>
          <Text style={styles.subtitle}>{statusDetail}</Text>
        </Entrance>

        {/* 3-step progress */}
        <Entrance delay={240} style={styles.steps}>
          {steps.map((s, i) => (
            <StepItem
              key={i}
              label={s.label}
              state={isOffline ? 'pending' : s.state}
              isLast={i === steps.length - 1}
            />
          ))}
        </Entrance>

        {isOffline && <Text style={styles.offlineNote}>Saving offline</Text>}
      </View>
    </View>
  );
}

function StepItem({ label, state, isLast }: { label: string; state: StepState; isLast: boolean }) {
  // The active step breathes so the user's eye lands on "what's happening now".
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state !== 'active') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  return (
    <View style={styles.stepItem}>
      <View style={styles.stepDotWrap}>
        <Animated.View
          style={[
            styles.stepDot,
            state === 'done' && styles.stepDotDone,
            state === 'active' && styles.stepDotActive,
            state === 'active' && { transform: [{ scale: pulse }] },
          ]}
        />
        {!isLast && <View style={styles.stepConnector} />}
      </View>
      <Text
        style={[
          styles.stepLabel,
          state === 'pending' && styles.stepLabelPending,
          state === 'active' && styles.stepLabelActive,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
    width: '100%',
    maxWidth: 420,
  },
  photoCard: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 10,
    marginBottom: 36,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    backgroundColor: theme.surfaceAlt,
  },
  beam: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  beamTint: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -60,
    height: 60,
    backgroundColor: 'rgba(59,59,232,0.10)',
  },
  title: {
    ...type.title,
    color: theme.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: theme.inkMuted,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },

  // 3-dot horizontal stepper
  steps: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 36,
  },
  stepItem: {
    alignItems: 'center',
    gap: 8,
    minWidth: 56,
  },
  stepDotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.border,
  },
  stepDotDone: {
    backgroundColor: theme.ink,
  },
  stepDotActive: {
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  stepConnector: {
    display: 'none', // dots-only; spacing via gap
  },
  stepLabel: {
    fontSize: 12,
    color: theme.ink,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  stepLabelPending: {
    color: theme.inkFaint,
    fontWeight: '500',
  },
  stepLabelActive: {
    color: theme.ink,
    fontWeight: '600',
  },

  offlineNote: {
    marginTop: 24,
    fontSize: 13,
    color: theme.warn,
    fontWeight: '500',
  },
});
