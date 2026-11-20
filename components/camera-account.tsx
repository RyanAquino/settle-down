import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccount } from '@/components/account';
import { theme } from '@/utils/theme';

export function CameraAccount() {
  const { profile, refresh, signOut } = useAccount();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const reset = profile?.resets_at;
  useEffect(() => {
    void refresh().catch(() => {});
    if (!reset) return;
    const timeout = setTimeout(
      () => {
        void refresh().catch(() => {});
      },
      Math.max(1000, Date.parse(reset) - Date.now() + 100),
    );
    return () => clearTimeout(timeout);
  }, [refresh, reset]);
  if (!profile) return null;
  const count = profile.remaining;
  const hint = count === 0 ? 'Next scan at midnight JST' : count === 1 ? '1 scan left today' : null;
  return (
    <>
      <Pressable
        testID="camera-account"
        accessibilityRole="button"
        onPress={() => {
          setOpen(true);
          void refresh().catch(() => {});
        }}
        style={[styles.header, { top: insets.top + 8 }]}
      >
        <Text numberOfLines={1} style={styles.headerText}>
          {profile.email}
        </Text>
        {hint && <Text style={styles.headerText}>{hint}</Text>}
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close account"
            onPress={() => setOpen(false)}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom) }]}>
            <Text style={styles.email}>{profile.email}</Text>
            <Text style={styles.balance}>
              {count === null
                ? 'Unlimited scans'
                : count === 1
                  ? '1 scan left today'
                  : count + ' scans left today'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void signOut().catch(() =>
                  Alert.alert('Unable to sign out', 'Check your connection and try again.'),
                )
              }
            >
              <Text style={styles.action}>Sign out</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
              <Text style={styles.action}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '85%',
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  headerText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.35)' },
  sheet: {
    padding: 24,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: theme.surface,
  },
  email: { fontSize: 20, fontWeight: '600', color: theme.ink },
  balance: { fontSize: 16, color: theme.inkMuted, marginVertical: 12 },
  action: { paddingVertical: 12, fontSize: 17, color: theme.accent },
});
