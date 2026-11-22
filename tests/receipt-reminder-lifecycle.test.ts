import { AppState, Linking, Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import {
  observeReminderPresentation,
  subscribeToVerifiedDeliveries,
} from '@/utils/verify-reminder-presentation';
import { draftPhotoUri, readDraft } from '@/utils/receipt-inbox';
import {
  parseReceiptReminder,
  presentReceiptReminder,
  receiptReminderForPresentation,
} from '@/utils/receipt-reminders';
import {
  openReminderSettings,
  setActiveReceiptDraft,
  startReceiptReminders,
} from '@/utils/receipt-reminder-lifecycle';

jest.mock('expo', () => ({
  ...jest.requireActual<typeof import('expo')>('expo'),
  isRunningInExpoGo: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'open',
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(),
  clearLastNotificationResponse: jest.fn(),
  setNotificationHandler: jest.fn(),
}));
jest.mock('@/utils/receipt-inbox', () => ({
  readDraft: jest.fn(),
  draftPhotoUri: jest.fn(),
  subscribeToInbox: jest.fn(() => jest.fn()),
}));
jest.mock('@/utils/receipt-reminders', () => ({
  getReceiptReminderPermission: jest.fn().mockResolvedValue('enabled'),
  syncReceiptReminders: jest.fn(async () => {}),
  parseReceiptReminder: jest.fn(),
  presentReceiptReminder: jest.fn().mockResolvedValue('updated'),
  receiptReminderForPresentation: jest.fn(),
}));

const source = { type: 'receipt-reminder', draftIds: '["a","b"]' };
const updated = {
  title: 'Receipt reminder',
  body: 'Ready to scan?',
  data: { ...source, draftIds: '["b"]' },
};
const notification: Notifications.Notification = {
  request: {
    identifier: 'morning',
    trigger: null,
    content: {
      title: 'Receipt reminder',
      body: '2 receipts',
      data: source,
      subtitle: null,
      categoryIdentifier: null,
      threadIdentifier: null,
      sound: 'default',
    },
  },
  date: 123,
};
const response = { notification, actionIdentifier: 'open' } as Notifications.NotificationResponse;
const getLast = jest.mocked(Notifications.getLastNotificationResponse);
const parse = jest.mocked(parseReceiptReminder);

beforeEach(() => {
  getLast.mockReturnValue(null);
  parse.mockReturnValue({ draftIds: ['a', 'b'] });
});

test.each([
  [true, 'host.exp.exponent'],
  [false, 'com.ryan.aquino.settledown'],
] as const)(
  'opens notification settings for the Android app hosting the receipt (Expo Go: %s)',
  async (expoGo, appPackage) => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    const intent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined);
    try {
      jest.mocked(isRunningInExpoGo).mockReturnValue(expoGo);
      await openReminderSettings();
      expect(intent).toHaveBeenCalledWith('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: appPackage },
      ]);
    } finally {
      Platform.OS = previousOS;
      intent.mockRestore();
    }
  },
);

test('cold and live delivery of the same tap navigates once and clears native state', () => {
  getLast.mockReturnValue(response);
  const navigate = jest.fn();
  const stop = startReceiptReminders(navigate);
  const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock
    .calls[0][0];
  listener(response);
  expect(navigate.mock.calls).toEqual([['/inbox']]);
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  stop?.();
});

test.each([
  [true, '/receipt-details'],
  [false, '/loading'],
] as const)('single tap opens the current draft (scanned: %s)', (scanned, pathname) => {
  parse.mockReturnValue({ draftIds: ['a'] });
  jest
    .mocked(readDraft)
    .mockReturnValue({ id: 'a', receipt: scanned ? {} : null } as NonNullable<
      ReturnType<typeof readDraft>
    >);
  jest.mocked(draftPhotoUri).mockReturnValue('file:///photo');
  getLast.mockReturnValue(response);
  const navigate = jest.fn();
  startReceiptReminders(navigate)?.();
  expect(navigate).toHaveBeenCalledWith({
    pathname,
    params: { draftId: 'a', photoUri: 'file:///photo', reminder: 'morning-123' },
  });
});

test('a stale single tap opens the inbox with a new notice', () => {
  parse.mockReturnValue({ draftIds: ['a'] });
  jest.mocked(readDraft).mockReturnValue(null);
  getLast.mockReturnValue(response);
  const navigate = jest.fn();
  startReceiptReminders(navigate)?.();
  expect(navigate).toHaveBeenCalledWith({
    pathname: '/inbox',
    params: { missingReceipt: 'morning-123' },
  });
});

test('delivery replaces a group with the remaining receipt and presents the replacement once', async () => {
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  const stop = startReceiptReminders(jest.fn());
  const previousScreen = setActiveReceiptDraft('b');
  const currentScreen = setActiveReceiptDraft('a');
  previousScreen();
  try {
    const handle = jest.mocked(Notifications.setNotificationHandler).mock.calls[0][0]!
      .handleNotification;
    jest.mocked(receiptReminderForPresentation).mockReturnValue(updated);
    parse.mockImplementation((data) => ({ draftIds: data === source ? ['a', 'b'] : ['b'] }));
    expect((await handle(notification)).shouldShowBanner).toBe(false);
    expect(receiptReminderForPresentation).toHaveBeenCalledWith(source, 'a');
    expect(presentReceiptReminder).toHaveBeenCalledWith(updated);
    const replacement = {
      ...notification,
      request: {
        ...notification.request,
        content: { ...notification.request.content, ...updated },
      },
    };
    expect((await handle(replacement)).shouldShowBanner).toBe(true);
    expect(presentReceiptReminder).toHaveBeenCalledTimes(1);
    jest.mocked(receiptReminderForPresentation).mockReturnValue(null);
    expect((await handle(notification)).shouldShowBanner).toBe(false);
    AppState.currentState = 'background';
    await handle(notification);
    expect(receiptReminderForPresentation).toHaveBeenLastCalledWith(source, null);
  } finally {
    AppState.currentState = previousState;
    currentScreen();
    stop?.();
  }
});

test('simulator evidence records suppression and replacement only after native acknowledgement', async () => {
  const record = jest.fn();
  const unsubscribe = subscribeToVerifiedDeliveries(record);
  const handleNotification = jest.fn().mockResolvedValue({ shouldShowBanner: false });
  const observer = observeReminderPresentation({ handleNotification }, () => 'a');
  try {
    await observer.handleNotification(notification);
    expect(record).not.toHaveBeenCalled();
    observer.handleError?.('morning', new Error('Native handler timed out'));
    observer.handleSuccess?.('morning');
    expect(record).not.toHaveBeenCalled();

    await observer.handleNotification(notification);
    observer.handleSuccess?.('morning');
    expect(record).toHaveBeenLastCalledWith({
      identifier: 'morning',
      openDraftId: 'a',
      description: 'Suppressed 2 receipts including this receipt',
    });
    handleNotification.mockResolvedValue({ shouldShowBanner: true });
    parse.mockReturnValue({ draftIds: ['b'] });
    const replacement = {
      ...notification,
      request: { ...notification.request, identifier: 'replacement' },
    };
    await observer.handleNotification(replacement);
    observer.handleSuccess?.('replacement');
    expect(record).toHaveBeenLastCalledWith({
      identifier: 'replacement',
      openDraftId: 'a',
      description: 'Presented 1 receipt excluding this receipt',
    });
  } finally {
    unsubscribe();
  }
});
