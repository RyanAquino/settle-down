import { randomUUID } from 'node:crypto';
import { isRunningInExpoGo, requireOptionalNativeModule, uuid } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { createPhotoDraft, removeDraft, saveDraft } from '@/utils/receipt-inbox';
import {
  askForReceiptReminders,
  getReceiptReminderPermission,
  parseReceiptReminder,
  receiptReminderForPresentation,
  scheduleVerificationReceiptReminder,
  syncReceiptReminders,
} from '@/utils/receipt-reminders';
import { samplePhoto, setupInboxFiles } from './support/inbox-files';

jest.mock('expo', () => ({
  ...jest.requireActual<typeof import('expo')>('expo'),
  isRunningInExpoGo: jest.fn(),
  requireOptionalNativeModule: jest.fn(),
}));
jest.mock('expo-file-system', () =>
  jest.requireActual<typeof import('./support/inbox-files')>('./support/inbox-files'),
);
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date', CALENDAR: 'calendar' },
  AndroidImportance: { DEFAULT: 3, NONE: 0 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getNotificationChannelAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
}));

const pending = new Map<string, Notifications.NotificationRequestInput>();
const savedAt = new Date(2026, 10, 30, 23, 15);
const threeHours = 3 * 60 * 60 * 1000;
const morningId = 'receipt-reminder:morning:2026-12-01';
const personalProject = randomUUID();
const orgProject = randomUUID();
const goMorningId = `receipt-reminder:${personalProject}:morning:2026-12-01`;
const setPermission = (status: 'granted' | 'denied' | 'undetermined') => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    granted: status === 'granted',
    canAskAgain: true,
    status,
  } as Notifications.NotificationPermissionsStatus);
};
const originalOS = Platform.OS;
setupInboxFiles();
beforeEach(() => {
  jest.useFakeTimers({ now: savedAt });
  jest.spyOn(uuid, 'v4').mockImplementation(randomUUID);
  Platform.OS = 'ios';
  pending.clear();
  Constants.easConfig = { projectId: personalProject };
  Constants.expoConfig = null;
  jest.mocked(isRunningInExpoGo).mockReturnValue(false);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  setPermission('granted');
  jest
    .mocked(Notifications.getAllScheduledNotificationsAsync)
    .mockImplementation(() =>
      Promise.resolve(Array.from(pending.values()) as Notifications.NotificationRequest[]),
    );
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation((request) => {
    const id = request.identifier ?? randomUUID();
    pending.set(id, request);
    return Promise.resolve(id);
  });
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation((id) => {
    pending.delete(id);
    return Promise.resolve();
  });
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('Expo Go schedules three elapsed hours and one month-end calendar fallback', async () => {
  jest.mocked(isRunningInExpoGo).mockReturnValue(true);
  const draft = await createPhotoDraft(samplePhoto().uri);
  const elapsedId = `receipt-reminder:${personalProject}:elapsed:${draft.id}`;
  await syncReceiptReminders();
  expect(pending.size).toBe(2);
  expect(pending.get(elapsedId)?.trigger).toMatchObject({
    type: 'date',
    date: +savedAt + threeHours,
  });
  expect(pending.get(goMorningId)?.trigger).toEqual({
    type: 'calendar',
    year: 2026,
    month: 12,
    day: 1,
    hour: 9,
    minute: 0,
    second: 0,
  });
  expect(pending.get(elapsedId)?.content.body).toBe('Ready to scan your saved receipt?');
  await syncReceiptReminders();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);

  // A delivered morning must stay consumed even if travel makes the same local 9 AM upcoming again.
  pending.delete(goMorningId);
  await syncReceiptReminders();
  expect(pending.has(goMorningId)).toBe(false);
});

test('the stale-tap fixture captures the saved receipt and waits for the Home screen before scheduling', async () => {
  Constants.expoConfig = {
    name: 'Settle Down',
    slug: 'settle-down',
    extra: { verifyReceiptReminders: true },
  };
  const remove = jest.fn();
  const listen = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  const draft = await createPhotoDraft(samplePhoto().uri);
  const scheduled = scheduleVerificationReceiptReminder('after-background');
  await Promise.resolve();
  const change = listen.mock.calls[0][1];
  removeDraft(draft.id);
  change('inactive');
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  jest.setSystemTime(+savedAt + 45_000);
  change('background');
  await scheduled;
  expect(remove).toHaveBeenCalledTimes(1);
  const [request] = [...pending.values()];
  expect(parseReceiptReminder(request.content.data)?.draftIds).toEqual([draft.id]);
  expect(request.trigger).toMatchObject({ type: 'date', date: Date.now() + 2000 });
});

test('simulator inspection records when the actual elapsed request was submitted without moving its deadline', async () => {
  Constants.expoConfig = {
    name: 'Settle Down',
    slug: 'settle-down',
    extra: { verifyReceiptReminders: true },
  };
  const draft = await createPhotoDraft(samplePhoto().uri);
  const registeredAt = +savedAt + 90_000;
  jest.setSystemTime(registeredAt);
  await syncReceiptReminders();
  const request = pending.get('receipt-reminder:elapsed:' + draft.id);
  expect(request?.content.data?.verifySubmittedAt).toBe(registeredAt);
  expect(request?.trigger).toMatchObject({ type: 'date', date: +savedAt + threeHours });
  jest.setSystemTime(registeredAt + 10_000);
  await syncReceiptReminders();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
});

test('one Expo Go project can schedule and discard a receipt while the other project keeps both reminders', async () => {
  jest.mocked(isRunningInExpoGo).mockReturnValue(true);
  const personal = await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  const personalRequests = new Map(pending);

  // The other copy has its own inbox and sees the same host notification center.
  removeDraft(personal.id);
  Constants.easConfig = null;
  Constants.expoConfig = {
    name: 'Settle Down',
    slug: 'settle-down',
    extra: { eas: { projectId: orgProject } },
  };
  const org = await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  expect(pending.size).toBe(4);
  const orgMorningId = `receipt-reminder:${orgProject}:morning:2026-12-01`;
  expect(parseReceiptReminder(pending.get(goMorningId)?.content.data)?.draftIds).toEqual([
    personal.id,
  ]);
  expect(parseReceiptReminder(pending.get(orgMorningId)?.content.data)?.draftIds).toEqual([org.id]);

  removeDraft(org.id);
  await syncReceiptReminders();
  expect(pending).toEqual(personalRequests);
});

test('an iOS native build uses the floating Gregorian calendar module for mornings only', async () => {
  const schedule = jest.fn(() => Promise.resolve());
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ schedule });
  const draft = await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  expect(schedule).toHaveBeenCalledWith(
    morningId,
    '2026-12-01',
    'Receipt reminder',
    'Ready to scan your saved receipt?',
    {
      morningDate: '2026-12-01',
      type: 'receipt-reminder',
      draftIds: JSON.stringify([draft.id]),
    },
  );
  expect([...pending.keys()]).toEqual(['receipt-reminder:elapsed:' + draft.id]);
});

test('Android Expo Go refreshes only the morning reminder when it resumes in a new time zone', async () => {
  Platform.OS = 'android';
  jest.mocked(isRunningInExpoGo).mockReturnValue(true);
  await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  const morning = pending.get(goMorningId)!;
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localMorning = new Date(2026, 11, 1, 9).getTime();
  expect(morning.content.data?.scheduledZone).toBe(localZone);
  // The OS still has the absolute timestamp scheduled before the device changed zones.
  pending.set(goMorningId, {
    ...morning,
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: localMorning + threeHours,
    },
    content: {
      ...morning.content,
      data: { ...morning.content.data, scheduledZone: localZone === 'UTC' ? 'Asia/Tokyo' : 'UTC' },
    },
  });
  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  await syncReceiptReminders();
  expect(pending.get(goMorningId)?.trigger).toMatchObject({ type: 'date', date: localMorning });
  expect(pending.get(goMorningId)?.content.data?.scheduledZone).toBe(localZone);
  await syncReceiptReminders();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('permission granted after the elapsed deadline only schedules the upcoming local morning', async () => {
  Platform.OS = 'android';
  setPermission('undetermined');
  await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  expect(pending.size).toBe(0);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  setPermission('granted');
  jest.setSystemTime(+savedAt + threeHours + 1);
  await syncReceiptReminders();
  expect([...pending.keys()]).toEqual([morningId]);
  expect(pending.get(morningId)?.trigger).toEqual({
    type: 'date',
    date: new Date(2026, 11, 1, 9).getTime(),
    channelId: 'receipt-reminders',
  });
  jest.setSystemTime(new Date(2026, 11, 1, 10));
  await syncReceiptReminders();
  expect(pending.size).toBe(0);
});

test('morning groups refresh on edits and removal; foreground delivery skips only the open draft', async () => {
  const first = await createPhotoDraft(samplePhoto().uri);
  const second = await createPhotoDraft(samplePhoto().uri);
  const receipt = {
    receipt_discount: 0,
    points_redeemed: 0,
    split_rules: { discounts: [], points: [] },
    en_shop_name: 'Private restaurant',
    jp_shop_name: '',
    receipt_date: savedAt,
    tax_percentage: 0,
    total_amount: 4,
    receipt_items: [
      { english_name: 'Soup', japanese_name: '', item_order: 8, quantity: 1, cost: 4, discount: 0 },
    ],
  };
  saveDraft({ ...second, receipt });
  await syncReceiptReminders();
  expect(pending.size).toBe(3);
  const group = pending.get(morningId)!.content;
  expect(group.body).toBe('2 saved receipts are waiting in your inbox.');
  const single = receiptReminderForPresentation(group.data, first.id);
  expect(single?.body).toBe('1 item left to assign on your saved receipt.');
  expect(parseReceiptReminder(single?.data)).toEqual({ draftIds: [second.id] });
  expect(receiptReminderForPresentation(single?.data, second.id)).toBeNull();
  saveDraft({
    ...second,
    receipt,
    edits: {
      costs: {},
      tax: '',
      date: savedAt.toISOString(),
      group: null,
      members: [],
      payer: '',
      assignments: { 8: 'shared' },
    },
  });
  removeDraft(first.id);
  await syncReceiptReminders();
  expect(pending.size).toBe(2);
  expect(pending.get(morningId)?.content.body).toBe('Your saved split is ready to review.');
  expect(JSON.stringify([...pending.values()])).not.toContain(receipt.en_shop_name);
  expect(receiptReminderForPresentation(group.data, second.id)).toBeNull();

  pending.set('unrelated', { identifier: 'unrelated', content: { title: 'Other' }, trigger: null });
  removeDraft(second.id);
  await syncReceiptReminders();
  expect([...pending.keys()]).toEqual(['unrelated']);
});

test('concurrent saves prompt once, and a dismissal remembered on disk sends subsequent saves to settings', async () => {
  Platform.OS = 'android';
  setPermission('denied'); // SDK 58 reports this on a fresh Android 13+ installation.
  expect(await getReceiptReminderPermission()).toBe('undetermined');
  await Promise.all([askForReceiptReminders(), askForReceiptReminders()]);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await getReceiptReminderPermission()).toBe('denied');
  await askForReceiptReminders();
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  setPermission('granted');
  expect(await getReceiptReminderPermission()).toBe('enabled');
});

test('disabling then enabling notifications restores future reminders and keeps missed mornings finished', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  await syncReceiptReminders();
  setPermission('denied');
  await syncReceiptReminders();
  expect(pending.size).toBe(0);
  setPermission('granted');
  await syncReceiptReminders();
  expect([...pending.keys()].sort()).toEqual(['receipt-reminder:elapsed:' + draft.id, morningId]);
  jest.setSystemTime(new Date(2026, 11, 1, 12));
  setPermission('denied');
  await syncReceiptReminders();
  // Moving the clock back represents a westward change after this morning has been skipped.
  jest.setSystemTime(new Date(2026, 11, 1, 8));
  setPermission('granted');
  await syncReceiptReminders();
  expect(pending.has(morningId)).toBe(false);
});

test.each([
  {},
  { type: 'receipt-reminder', draftIds: 'bad json' },
  { type: 'receipt-reminder', draftIds: '["../path"]' },
])('ignores an unrelated or malformed notification payload', (data) =>
  expect(parseReceiptReminder(data)).toBeNull(),
);
