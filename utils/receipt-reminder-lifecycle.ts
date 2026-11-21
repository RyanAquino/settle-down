import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { Href } from 'expo-router';
import { draftPhotoUri, readDraft, subscribeToInbox } from '@/utils/receipt-inbox';
import {
  askForReceiptReminders,
  getReceiptReminderPermission,
  parseReceiptReminder,
  presentReceiptReminder,
  receiptReminderForPresentation,
  syncReceiptReminders,
} from '@/utils/receipt-reminders';

const native = Platform.OS === 'android' || Platform.OS === 'ios';
type Permission = Awaited<ReturnType<typeof getReceiptReminderPermission>>;
let permission: Permission = 'undetermined';
let focused: { id: string } | null = null;
const listeners = new Set<() => void>();

export function subscribeReminderPermission(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReminderPermissionSnapshot() {
  return permission;
}

export function setActiveReceiptDraft(id: string) {
  const screen = { id };
  focused = screen;
  return () => {
    if (focused === screen) focused = null;
  };
}

async function refreshPermission() {
  const next = await getReceiptReminderPermission();
  if (permission !== next) {
    permission = next;
    for (const listener of listeners) listener();
  }
}

function reportReminderError(error: unknown) {
  console.warn('[receipt-reminders]', error);
}

function synchronize() {
  void syncReceiptReminders().catch(reportReminderError);
}

export async function receiptLeftForLater() {
  if (!native) return;
  try {
    await askForReceiptReminders();
    await refreshPermission();
    await syncReceiptReminders();
  } catch (error) {
    reportReminderError(error);
  }
}

export async function openReminderSettings() {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:notifications');
    } else if (Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        {
          key: 'android.provider.extra.APP_PACKAGE',
          value: Constants.expoConfig?.android?.package ?? 'com.ryan.aquino.settledown',
        },
      ]);
    }
  } catch {
    await Linking.openSettings();
  }
}

const visibility = (show: boolean): Notifications.NotificationBehavior => ({
  shouldShowBanner: show,
  shouldShowList: show,
  shouldPlaySound: show,
  shouldSetBadge: false,
});

// Native schedules stay armed even while editing. If the app is suspended or killed,
// delivery does not depend on JavaScript running a background transition.
function presentation({ request }: Notifications.Notification) {
  const original = parseReceiptReminder(request.content.data);
  if (!original) return visibility(false);
  const activeId = AppState.currentState === 'active' ? (focused?.id ?? null) : null;
  const updated = receiptReminderForPresentation(request.content.data, activeId);
  if (!updated) return visibility(false);
  const remaining = parseReceiptReminder(updated.data);
  if (
    original.draftIds.length !== remaining?.draftIds.length ||
    request.content.title !== updated.title ||
    request.content.body !== updated.body
  ) {
    void presentReceiptReminder(updated).catch(reportReminderError);
    return visibility(false);
  }
  return visibility(true);
}

export function startReceiptReminders(navigate: (href: Href) => void) {
  if (!native) return;
  Notifications.setNotificationHandler({
    handleNotification: (notification) => Promise.resolve(presentation(notification)),
  });
  const unsubscribe = subscribeToInbox(synchronize);
  function resume() {
    void refreshPermission().catch(reportReminderError);
    synchronize();
  }
  const state = AppState.addEventListener('change', (next) => {
    if (next === 'active') resume();
  });
  let lastTap = '';
  function respond(response: Notifications.NotificationResponse | null) {
    if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { request, date } = response.notification;
    const reminder = parseReceiptReminder(request.content.data);
    if (!reminder) return;
    const token = request.identifier + '-' + date;
    if (token === lastTap) return;
    lastTap = token;
    if (reminder.draftIds.length > 1) {
      navigate('/inbox');
    } else {
      const draft = readDraft(reminder.draftIds[0]);
      if (draft) {
        navigate({
          pathname: draft.receipt ? '/receipt-details' : '/loading',
          params: { draftId: draft.id, photoUri: draftPhotoUri(draft), reminder: token },
        });
      } else {
        navigate({ pathname: '/inbox', params: { missingReceipt: token } });
      }
    }
    Notifications.clearLastNotificationResponse();
  }
  const taps = Notifications.addNotificationResponseReceivedListener(respond);
  respond(Notifications.getLastNotificationResponse());
  resume();
  return () => {
    taps.remove();
    state.remove();
    unsubscribe();
    Notifications.setNotificationHandler(null);
  };
}
