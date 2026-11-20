import { useAccount } from '@/components/account';
import { randomUUID } from 'expo-crypto';
import { View, Text, StyleSheet, Image, Animated, Easing } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import * as MediaLibrary from 'expo-media-library/legacy';
import { File } from 'expo-file-system';
import { theme, type } from '@/utils/theme';
import { Entrance, PressableScale } from '@/components/motion';
import { scanReconciledReceipt } from '@/utils/receipt-preview';
import { retryApiCall } from '@/utils/retry';

class ScanLimitError extends Error {}

const scanSteps = [
  { label: 'Capture', state: 'done' },
  { label: 'Read', state: 'active' },
  { label: 'Assign', state: 'pending' },
] as const;

type StepState = (typeof scanSteps)[number]['state'];

export default function LoadingScreen() {
  const { request } = useAccount();
  const [scanId] = useState(randomUUID);
  const params = useLocalSearchParams();
  const photoUri = params.photoUri as string;
  const fromLibrary = params.fromLibrary === 'true';
  const [isOffline, setIsOffline] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Reading receipt');
  const [statusDetail, setStatusDetail] = useState('Extracting items and amounts');
  const [needsRetake, setNeedsRetake] = useState(false);

  // scanning beam animation — sweeps top to bottom and back
  const [beam] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (isOffline || needsRetake) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beam, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut((t) => Easing.ease(t)),
          useNativeDriver: true,
        }),
        Animated.timing(beam, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut((t) => Easing.ease(t)),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beam, isOffline, needsRetake]);

  const savePhotoAsFallback = useCallback(
    async (photoUri: string) => {
      try {
        if (!fromLibrary) {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === MediaLibrary.PermissionStatus.GRANTED) {
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
        router.replace({
          pathname: '/',
          params: { error: 'Upload failed. Unable to save photo.' },
        });
      }
    },
    [fromLibrary],
  );

  const uploadPhoto = useCallback(
    async (uri: string, signal: AbortSignal) => {
      try {
        const headers = { 'Idempotency-Key': scanId };
        const readPhoto = () => {
          let attempt = 0;
          return retryApiCall(
            async () => {
              if (signal.aborted) throw new Error('Receipt scan cancelled.');
              attempt++;
              if (attempt > 1) {
                setStatusMessage(`Retrying connection · ${attempt} of 3`);
                setStatusDetail('Uploading the same receipt photo.');
              }
              const body = new FormData();
              // Expo's multipart encoder reads bytes from File and sets the boundary.
              body.append('file', new File(uri));
              const response = await request('receipts/receipt-items/', {
                method: 'POST',
                body,
                headers,
                signal,
              });
              if (response.status === 429) throw new ScanLimitError();
              if (!response.ok) throw new Error(`Receipt upload failed (HTTP ${response.status})`);
              const data: unknown = await response.json();
              return data;
            },
            3,
            1000,
            (error) => !(error instanceof ScanLimitError) && !signal.aborted,
          );
        };

        const receipt = await scanReconciledReceipt(readPhoto, () => {
          if (signal.aborted) return;
          setStatusMessage('Reading receipt again');
          setStatusDetail('Checking the items against the scanned total.');
        });
        if (signal.aborted) return;
        if (!receipt) {
          setNeedsRetake(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace({
          pathname: '/receipt-details',
          params: { data: JSON.stringify(receipt), photoUri: uri },
        });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ScanLimitError) {
          router.replace({ pathname: '/', params: { error: 'Next scan at midnight JST.' } });
          return;
        }
        console.warn('[upload] Could not scan receipt', error);
        await savePhotoAsFallback(uri);
      }
    },
    [savePhotoAsFallback, request, scanId],
  );

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
      if (status !== MediaLibrary.PermissionStatus.GRANTED)
        throw new Error('Media library permission denied');
      await MediaLibrary.saveToLibraryAsync(photoUri);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        router.replace({
          pathname: '/',
          params: { message: 'Photo saved to your photo library.' },
        });
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
    async (uri: string, signal: AbortSignal) => {
      try {
        const netInfoState = await NetInfo.fetch();
        if (signal.aborted) return;
        console.log(
          `[netinfo] isConnected=${netInfoState.isConnected} type=${netInfoState.type} isInternetReachable=${netInfoState.isInternetReachable}`,
        );
        // Only an explicit `false` means offline. A strict `=== true` check treats an
        // unknown (`null`) reading as offline and routes to the save-photo path without
        // ever attempting the upload — a silent false-negative.
        const isConnected = netInfoState.isConnected !== false;
        if (isConnected) {
          await uploadPhoto(uri, signal);
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
        if (signal.aborted) return;
        setIsOffline(true);
        setStatusMessage('Network check failed');
        setStatusDetail('Falling back to offline mode.');
        await handleOfflinePhoto(uri);
      }
    },
    [uploadPhoto, handleOfflinePhoto, fromLibrary],
  );

  useEffect(() => {
    // Kicks off the async upload pipeline on mount; every setState inside
    // happens after `await NetInfo.fetch()`, so none are synchronous here.
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (photoUri) void checkConnectivityAndProcess(photoUri, controller.signal);
    return () => controller.abort();
  }, [photoUri, checkConnectivityAndProcess]);

  // beam translateY: 0 → photoHeight, within the card
  const PHOTO_H = 260;
  const beamY = beam.interpolate({ inputRange: [0, 1], outputRange: [0, PHOTO_H - 2] });
  const beamOpacity = isOffline || needsRetake ? 0 : 1;

  if (needsRetake) {
    return (
      <View style={styles.container}>
        <View style={[styles.content, styles.retakeContent]}>
          <Image
            accessibilityLabel="Original receipt photo"
            source={{ uri: photoUri }}
            style={styles.retakePhoto}
            resizeMode="contain"
          />
          <Text style={styles.title}>Couldn’t verify the receipt total</Text>
          <Text style={styles.subtitle}>
            Retake the photo with every item, the tax, and the total visible.
          </Text>
          <PressableScale
            style={styles.retakeButton}
            testID="retake-receipt-photo"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/');
            }}
          >
            <Text style={styles.retakeButtonText}>Retake photo</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

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
          {scanSteps.map((s, i) => (
            <StepItem
              key={s.label}
              label={s.label}
              state={isOffline ? 'pending' : s.state}
              isLast={i === scanSteps.length - 1}
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
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (state !== 'active') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.45,
          duration: 700,
          easing: Easing.inOut((t) => Easing.ease(t)),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut((t) => Easing.ease(t)),
          useNativeDriver: true,
        }),
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
  retakeContent: { flex: 1, justifyContent: 'center' },
  retakePhoto: {
    width: '100%',
    height: '48%',
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface,
    marginBottom: 24,
  },
  retakeButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: theme.radius,
    backgroundColor: theme.ink,
  },
  retakeButtonText: { ...type.body, color: theme.surface },
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
