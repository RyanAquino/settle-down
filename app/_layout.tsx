import { AccountProvider, useAccount } from '@/components/account';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AccountProvider>
      <Routes />
    </AccountProvider>
  );
}

function Routes() {
  const { ready, profile } = useAccount();
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F5F5F7' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Protected guard={!!profile}>
          <Stack.Screen name="index" />
          <Stack.Screen name="camera" />
          <Stack.Screen name="loading" />
          <Stack.Screen name="receipt-details" />
        </Stack.Protected>
        <Stack.Protected guard={!profile}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
