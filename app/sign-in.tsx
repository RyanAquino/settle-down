import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useAccount } from '@/components/account';
import { theme } from '@/utils/theme';

export default function SignIn() {
  const { signIn } = useAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = busy || !email.trim() || !password;
  const submit = async () => {
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Sign in with Settle Up
      </Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        testID="account-email"
        accessibilityLabel="Email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        testID="account-password"
        accessibilityLabel="Password"
        secureTextEntry
        autoComplete="current-password"
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        testID="account-submit"
        disabled={disabled}
        style={[styles.button, disabled && { opacity: 0.5 }]}
        onPress={() => void submit()}
      >
        <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.bg,
    paddingHorizontal: 28,
    gap: 8,
  },
  title: { color: theme.ink, fontSize: 30, fontWeight: '700', marginBottom: 20 },
  label: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  input: {
    backgroundColor: theme.surface,
    color: theme.ink,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: theme.radiusSm,
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 17,
    marginBottom: 12,
  },
  error: { color: theme.danger },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    backgroundColor: theme.ink,
    borderRadius: theme.radius,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
