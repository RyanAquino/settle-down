import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { type EventSubscription } from "expo-modules-core";
import Constants from "expo-constants";
import { clearPendingJob } from "../utils/jobStorage";

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications don't work in simulator/emulator
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return tokenData.data;
}

async function sendPushTokenToBackend(token: string): Promise<void> {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;

  const headers: { [key: string]: string } = {
    "ngrok-skip-browser-warning": "true",
    "Content-Type": "application/json",
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    await fetch(`${apiBaseUrl}/api/v1/devices/register/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expo_push_token: token }),
    });
  } catch {
    // Silently fail -- token registration is best-effort.
    // The backend may not have this endpoint yet.
  }
}

export default function RootLayout() {
  const notificationResponseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    // Register for push notifications on launch
    registerForPushNotifications().then((token) => {
      if (token) {
        sendPushTokenToBackend(token);
      }
    });

    // Listen for when user taps a notification
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        const jobId = data?.job_id as string | undefined;
        const status = data?.status as string | undefined;

        if (!jobId) return;

        if (status === "failed") {
          // Processing failed -- clear the pending job and go to camera
          clearPendingJob();
          router.replace({
            pathname: "/",
            params: { error: "Receipt processing failed. Please try again." },
          });
        } else {
          // Processing succeeded -- navigate to receipt details with job_id
          clearPendingJob();
          router.replace({
            pathname: "/receipt-details",
            params: { jobId },
          });
        }
      });

    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}