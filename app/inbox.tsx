import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/motion';
import { draftPhotoUri, listDrafts, removeDraft, type ReceiptDraft } from '@/utils/receipt-inbox';
import {
  getReminderPermissionSnapshot,
  openReminderSettings,
  subscribeReminderPermission,
} from '@/utils/receipt-reminder-lifecycle';
import { scheduleVerificationReceiptReminder } from '@/utils/receipt-reminders';
import { theme, type } from '@/utils/theme';

export default function ReceiptInboxScreen() {
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [failed, setFailed] = useState(false);
  const { missingReceipt } = useLocalSearchParams<{ missingReceipt?: string }>();
  const [dismissedNotice, setDismissedNotice] = useState<string>();
  const permission = useSyncExternalStore(
    subscribeReminderPermission,
    getReminderPermissionSnapshot,
    getReminderPermissionSnapshot,
  );
  useEffect(() => {
    if (!missingReceipt) return;
    const timeout = setTimeout(() => setDismissedNotice(missingReceipt), 4500);
    return () => clearTimeout(timeout);
  }, [missingReceipt]);

  const opening = useRef(false);
  const reload = useCallback(() => {
    try {
      setDrafts(listDrafts());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      opening.current = false;
      reload();
    }, [reload]),
  );

  function open(draft: ReceiptDraft) {
    if (opening.current) return;
    opening.current = true;
    const params = { draftId: draft.id, photoUri: draftPhotoUri(draft) };
    if (draft.receipt) router.push({ pathname: '/receipt-details', params });
    else router.push({ pathname: '/loading', params });
  }

  function discard(draft: ReceiptDraft) {
    Alert.alert(
      'Discard this receipt?',
      'This removes the draft and its inbox photo from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            try {
              removeDraft(draft.id);
              reload();
            } catch {
              Alert.alert('Couldn’t discard receipt', 'Please try again.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <PressableScale
          accessibilityLabel="Back"
          style={styles.back}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        >
          <Text style={styles.backText}>←</Text>
        </PressableScale>
        <Text style={styles.title}>Receipt inbox</Text>
        {permission === 'denied' && (
          <PressableScale
            style={styles.settings}
            onPress={() => {
              void openReminderSettings().catch(() =>
                Alert.alert('Couldn’t open notification settings', 'Please try again.'),
              );
            }}
          >
            <Text style={styles.action}>Enable reminders</Text>
          </PressableScale>
        )}
      </View>
      {Constants.expoConfig?.extra?.verifyReceiptReminders === true &&
        drafts.length > 0 &&
        permission === 'enabled' && (
          <PressableScale
            testID="verify-receipt-reminder"
            style={styles.notice}
            onPress={() => {
              void scheduleVerificationReceiptReminder().catch(() =>
                Alert.alert('Couldn’t schedule test reminder'),
              );
            }}
          >
            <Text style={styles.action}>Test reminder in 8 seconds</Text>
          </PressableScale>
        )}
      {missingReceipt && missingReceipt !== dismissedNotice && (
        <Text accessibilityRole="alert" style={styles.missingNotice}>
          This receipt is no longer in your inbox.
        </Text>
      )}
      <FlatList
        contentContainerStyle={styles.list}
        data={drafts}
        keyExtractor={(draft) => draft.id}
        ListHeaderComponent={
          failed ? (
            <PressableScale style={styles.notice} onPress={reload}>
              <Text style={styles.action}>Couldn’t load the inbox. Tap to retry.</Text>
            </PressableScale>
          ) : undefined
        }
        ListEmptyComponent={
          failed ? undefined : (
            <View style={styles.notice}>
              <Text style={styles.name}>No saved receipts</Text>
              <Text style={styles.meta}>Your photos and unfinished splits will appear here.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const name = item.receipt?.en_shop_name || item.receipt?.jp_shop_name || 'Receipt photo';
          const status = item.receipt ? 'Continue split' : 'Scan receipt';
          return (
            <View style={styles.card}>
              <PressableScale
                style={styles.open}
                accessibilityLabel={`${status}, ${name}`}
                onPress={() => open(item)}
              >
                <Image source={{ uri: draftPhotoUri(item) }} style={styles.photo} />
                <View style={styles.details}>
                  <Text style={styles.name} numberOfLines={2}>
                    {name}
                  </Text>
                  <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
                  <Text style={styles.action}>{status}</Text>
                </View>
              </PressableScale>
              <PressableScale
                style={styles.discard}
                accessibilityLabel={`Discard ${name}`}
                onPress={() => discard(item)}
              >
                <Text style={styles.discardText}>Discard</Text>
              </PressableScale>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  title: { ...type.title, color: theme.ink, flexShrink: 1 },
  settings: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  missingNotice: { ...type.body, color: theme.ink, marginHorizontal: 16, marginBottom: 8 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { ...type.title, color: theme.ink },
  list: { padding: 16, gap: 12 },
  card: {
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  open: { flex: 1, paddingVertical: 14, flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 48, height: 64, borderRadius: theme.radiusSm, backgroundColor: theme.bg },
  details: { flex: 1, gap: 3 },
  name: { ...type.body, color: theme.ink },
  meta: { ...type.label, color: theme.inkMuted },
  action: { ...type.label, color: theme.accent },
  discard: { paddingVertical: 14, paddingHorizontal: 8 },
  discardText: { ...type.label, color: theme.danger },
  notice: { padding: 16, gap: 6, backgroundColor: theme.surface, borderRadius: theme.radius },
});
