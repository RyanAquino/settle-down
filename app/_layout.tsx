import { useEffect } from 'react';
import { router, Stack, useRootNavigationState } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { startReceiptReminders } from '@/utils/receipt-reminder-lifecycle';

export default function RootLayout() {
  const ready = Boolean(useRootNavigationState()?.key);
  useEffect(() => {
    if (ready) return startReceiptReminders((href) => router.navigate(href));
  }, [ready]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F5F5F7' },
          animation: 'slide_from_right',
        }}
      />
    </SafeAreaProvider>
  );
}
