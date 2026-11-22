import { View, Text, StyleSheet, Image, Animated, Easing, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { theme, type } from '@/utils/theme';
import { Entrance, PressableScale } from '@/components/motion';
import { scanReconciledReceipt } from '@/utils/receipt-preview';
import {
  createPhotoDraft,
  draftPhotoUri,
  readDraft,
  removeDraft,
  saveDraft,
  type ReceiptDraft,
} from '@/utils/receipt-inbox';
import { receiptLeftForLater } from '@/utils/receipt-reminder-lifecycle';
import { useActiveReceiptDraft } from '@/utils/use-active-receipt-draft';
import { retryApiCall } from '@/utils/retry';

const scanSteps = [
  { label: 'Capture', state: 'done' },
  { label: 'Read', state: 'active' },
  { label: 'Assign', state: 'pending' },
] as const;

type StepState = (typeof scanSteps)[number]['state'];

export default function LoadingScreen() {
  const params = useLocalSearchParams();
  const photoUri = typeof params.photoUri === 'string' ? params.photoUri : '';
  const draftId = typeof params.draftId === 'string' ? params.draftId : '';
  const reminder = typeof params.reminder === 'string' ? params.reminder : '';
  const [activeDraft, setActiveDraft] = useState<ReceiptDraft | null>(null);
  useActiveReceiptDraft(draftId || activeDraft?.id);
  const importing = useRef<{ uri: string; result: Promise<ReceiptDraft> } | null>(null);
  const fromLibrary = params.fromLibrary === 'true';
  const verifyOfflineImport =
    Constants.expoConfig?.extra?.verifyOfflineImport === true &&
    params.verifyOfflineImport === 'true';
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

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function returnToInbox(draft: ReceiptDraft | null, offline: boolean) {
      if (draft) {
        if (draftId && !reminder && router.canGoBack()) router.back();
        else router.replace('/inbox');
        await receiptLeftForLater();
        Alert.alert(
          offline ? 'You’re offline' : 'Couldn’t scan receipt',
          'Your photo is in the receipt inbox. Open it when you’re ready to scan.',
        );
      } else {
        const message = fromLibrary
          ? 'The photo is in your photo library. Select it again to scan.'
          : 'Couldn’t save the receipt to your inbox. Please retake the photo.';
        router.replace({ pathname: '/', params: { error: message } });
      }
    }

    async function processPhoto() {
      let draft: ReceiptDraft | null = null;
      if (draftId) {
        draft = readDraft(draftId);
        if (!draft) {
          router.replace(
            reminder ? { pathname: '/inbox', params: { missingReceipt: reminder } } : '/inbox',
          );
          return;
        }
      } else {
        if (!photoUri) {
          router.replace('/');
          return;
        }
        // Keep the same import across effect replay while the large photo is copying.
        if (importing.current?.uri !== photoUri) {
          importing.current = { uri: photoUri, result: createPhotoDraft(photoUri) };
        }
        try {
          draft = await importing.current.result;
        } catch {
          // Try scanning the original photo if the inbox copy failed.
        }
      }
      if (signal.aborted) return;
      setActiveDraft(draft);
      const uri = draft ? draftPhotoUri(draft) : photoUri;
      const details = (data: string) =>
        router.replace({
          pathname: '/receipt-details',
          params: {
            data,
            photoUri: uri,
            ...(draft && { draftId: draft.id }),
            ...(reminder && { reminder }),
          },
        });
      if (draft?.receipt) {
        details(JSON.stringify(draft.receipt));
        return;
      }

      const network = verifyOfflineImport
        ? { isConnected: false }
        : await NetInfo.fetch().catch(() => null);
      if (signal.aborted) return;
      if (network?.isConnected === false) {
        setIsOffline(true);
        setStatusMessage('You’re offline');
        setStatusDetail('Saving your receipt for later.');
        await returnToInbox(draft, true);
        return;
      }

      try {
        const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
        if (!apiBaseUrl) throw new Error('EXPO_PUBLIC_API_BASE_URL is missing from this build.');
        const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
        const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        const readPhoto = () => {
          let attempt = 0;
          return retryApiCall(async () => {
            if (signal.aborted) throw new Error('Receipt scan cancelled.');
            if (++attempt > 1) {
              setStatusMessage(`Retrying connection · ${attempt} of 3`);
              setStatusDetail('Uploading the same receipt photo.');
            }
            const body = new FormData();
            body.append('file', new File(uri));
            const response = await fetch(`${apiBaseUrl}/api/v1/receipts/receipt-items/`, {
              method: 'POST',
              body,
              headers,
              signal,
            });
            if (!response.ok) throw new Error(`Receipt upload failed (HTTP ${response.status})`);
            const data: unknown = await response.json();
            return data;
          });
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
        if (draft) {
          try {
            saveDraft({ ...draft, receipt });
          } catch {
            Alert.alert('Couldn’t save the scan', 'You can still finish this receipt now.');
          }
        } else {
          Alert.alert('Couldn’t save a draft', 'You can still finish this receipt now.');
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        details(JSON.stringify(receipt));
      } catch (error) {
        if (signal.aborted) return;
        console.warn('[upload] Could not scan receipt', error);
        await returnToInbox(draft, false);
      }
    }

    void processPhoto().catch(() => {
      if (signal.aborted) return;
      Alert.alert('Couldn’t open receipt', 'Please try again.');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
    return () => controller.abort();
  }, [verifyOfflineImport, photoUri, fromLibrary, draftId, reminder]);

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
              if (activeDraft) {
                try {
                  removeDraft(activeDraft.id);
                } catch {
                  Alert.alert('Couldn’t discard the photo', 'Please try again.');
                  return;
                }
              }
              if (draftId) router.dismissTo('/');
              else if (router.canGoBack()) router.back();
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
