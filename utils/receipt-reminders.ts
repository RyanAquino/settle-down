import { isRunningInExpoGo, PermissionStatus, requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';
import { listDrafts, readDraft, type ReceiptDraft } from '@/utils/receipt-inbox';
import { nextMorningDate } from '@/utils/receipt-morning';

const channelId = 'receipt-reminders';
const easProject = z.object({ projectId: z.uuid() });
const threeHours = 3 * 60 * 60 * 1000;
const native = () => Platform.OS === 'ios' || Platform.OS === 'android';
const promptMarker = () => new File(Paths.document, 'receipt-reminder-permission-requested');

async function createChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Receipt reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }
}

export async function getReceiptReminderPermission(): Promise<
  'enabled' | 'denied' | 'undetermined'
> {
  if (!native()) return 'undetermined';
  const permission = await Notifications.getPermissionsAsync();
  if (
    permission.status === PermissionStatus.GRANTED ||
    permission.ios?.status === IosAuthorizationStatus.PROVISIONAL ||
    permission.ios?.status === IosAuthorizationStatus.EPHEMERAL
  ) {
    if (Platform.OS === 'android') {
      const channel = await Notifications.getNotificationChannelAsync(channelId);
      if (channel?.importance === AndroidImportance.NONE) return 'denied';
    }
    return 'enabled';
  }
  if (promptMarker().exists) return 'denied';
  // On Android 13+ Expo reports DENIED before the first prompt because OS notifications are off.
  if (Platform.OS === 'android' && !permission.granted && permission.canAskAgain)
    return 'undetermined';
  if (permission.status === PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

let prompt: Promise<void> | null = null;
export function askForReceiptReminders(): Promise<void> {
  if (!native()) return Promise.resolve();
  if (!prompt) {
    prompt = (async () => {
      const permission = await getReceiptReminderPermission();
      if (permission !== 'undetermined') {
        if (permission === 'enabled' && !promptMarker().exists) promptMarker().writeSync('1');
        return;
      }
      // Android 13+ needs a channel before the runtime permission dialog can appear.
      await createChannel();
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      promptMarker().writeSync('1');
    })().finally(() => {
      prompt = null;
    });
  }
  return prompt;
}

const payload = z.object({ type: z.literal('receipt-reminder'), draftIds: z.string() });
const ids = z.array(z.uuid()).min(1);

export function parseReceiptReminder(data: unknown): { draftIds: string[] } | null {
  const result = payload.safeParse(data);
  if (!result.success) return null;
  try {
    // Keep Expo notification data scalar across Android Bundles and iOS userInfo.
    const parsed = ids.safeParse(JSON.parse(result.data.draftIds));
    return parsed.success ? { draftIds: parsed.data } : null;
  } catch {
    return null;
  }
}

function reminderContent(drafts: ReceiptDraft[], morningDate?: string, scheduledZone?: string) {
  let body: string;
  if (drafts.length > 1) {
    body = `${drafts.length} saved receipts are waiting in your inbox.`;
  } else {
    const { receipt, edits } = drafts[0];
    if (!receipt) {
      body = 'Ready to scan your saved receipt?';
    } else {
      const count = receipt.receipt_items.filter(
        (item) => !edits?.assignments[item.item_order],
      ).length;
      body = count
        ? `${count} ${count === 1 ? 'item' : 'items'} left to assign on your saved receipt.`
        : 'Your saved split is ready to review.';
    }
  }
  return {
    title: 'Receipt reminder',
    body,
    sound: 'default',
    data: {
      type: 'receipt-reminder',
      draftIds: JSON.stringify(drafts.map((draft) => draft.id)),
      ...(morningDate && { morningDate }),
      ...(scheduledZone && { scheduledZone }),
    },
  };
}

export function receiptReminderForPresentation(
  data: unknown,
  activeId: string | null,
): Notifications.NotificationContentInput | null {
  const reminder = parseReceiptReminder(data);
  if (!reminder) return null;
  const drafts = reminder.draftIds
    .filter((id) => id !== activeId)
    .map(readDraft)
    .filter((draft) => draft !== null);
  return drafts.length ? reminderContent(drafts) : null;
}

export function presentReceiptReminder(content: Notifications.NotificationContentInput) {
  return Notifications.scheduleNotificationAsync({
    content,
    trigger: Platform.OS === 'android' ? { channelId } : null,
  });
}

// Exercise the normal device delivery and tap handler in PR simulator builds.
export async function scheduleVerificationReceiptReminder() {
  if (!native() || Constants.expoConfig?.extra?.verifyReceiptReminders !== true) return;
  const drafts = listDrafts();
  if (!drafts.length) return;
  await createChannel();
  await Notifications.scheduleNotificationAsync({
    content: reminderContent(drafts),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Date.now() + 8000,
      channelId,
    },
  });
}

const morningState = z.record(
  z.string(),
  z.object({ date: z.iso.date(), status: z.enum(['pending', 'armed', 'finished']) }),
);
type MorningState = z.infer<typeof morningState>;

function readMorningState(file: File): MorningState {
  if (!file.exists) return {};
  try {
    return morningState.parse(JSON.parse(file.textSync()));
  } catch {
    return {};
  }
}

type Reminder = {
  identifier: string;
  dueAt: number;
  drafts: ReceiptDraft[];
  morningDate?: string;
};

function scheduledReminders(
  prefix: string,
  drafts: ReceiptDraft[],
  previous: MorningState,
  requests: Map<string, Notifications.NotificationRequest>,
  enabled: boolean,
  now: number,
) {
  const upcoming = new Map<string, Reminder>();
  const state: MorningState = {};
  for (const draft of drafts) {
    const dueAt = draft.createdAt + threeHours;
    if (enabled && dueAt > now) {
      const identifier = prefix + 'elapsed:' + draft.id;
      upcoming.set(identifier, { identifier, dueAt, drafts: [draft] });
    }

    // Older drafts lack a creation-time local date. Keep their first inferred date across travel.
    const prior = previous[draft.id];
    const morningDate = draft.morningDate ?? prior?.date ?? nextMorningDate(draft.createdAt);
    const morningAt = new Date(morningDate + 'T09:00:00').getTime();
    const identifier = prefix + 'morning:' + morningDate;
    // A disappeared, previously armed one-shot has fired (or the native time-zone receiver
    // skipped it). Flying west across 9 AM must never create a second morning alert.
    if (
      morningAt <= now ||
      prior?.status === 'finished' ||
      (enabled && prior?.status === 'armed' && !requests.has(identifier))
    ) {
      state[draft.id] = { date: morningDate, status: 'finished' };
      continue;
    }
    state[draft.id] = { date: morningDate, status: enabled ? 'armed' : 'pending' };
    if (!enabled) continue;
    const group = upcoming.get(identifier);
    if (group) group.drafts.push(draft);
    else upcoming.set(identifier, { identifier, dueAt: morningAt, drafts: [draft], morningDate });
  }
  return { upcoming, state };
}

function triggerFor(reminder: Reminder): Notifications.NotificationTriggerInput {
  if (reminder.morningDate && Platform.OS === 'ios') {
    const [year, month, day] = reminder.morningDate.split('-').map(Number);
    // Calendar passes these values directly to Foundation (January is 1). Omit the time zone.
    return {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      year,
      month,
      day,
      hour: 9,
      minute: 0,
      second: 0,
    };
  }
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.dueAt, channelId };
}

type ReceiptReminderCalendar = {
  schedule(
    identifier: string,
    calendarDate: string,
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<void>;
};

async function reconcile() {
  // Expo Go shares a notification center between the personal and organization projects.
  const expoGo = isRunningInExpoGo();
  let prefix = 'receipt-reminder:';
  if (expoGo) {
    const projectId =
      Constants.easConfig?.projectId ??
      easProject.parse(Constants.expoConfig?.extra?.eas).projectId;
    prefix += projectId + ':';
  }
  const enabled = (await getReceiptReminderPermission()) === 'enabled';
  const pending = (await Notifications.getAllScheduledNotificationsAsync()).filter((request) =>
    request.identifier.startsWith(prefix),
  );
  const requests = new Map(pending.map((request) => [request.identifier, request]));
  const drafts = listDrafts();
  const file = new File(Paths.document, 'receipt-reminder-mornings.json');
  const previous = readMorningState(file);
  const { upcoming, state } = scheduledReminders(
    prefix,
    drafts,
    previous,
    requests,
    enabled,
    Date.now(),
  );
  if (upcoming.size) await createChannel();
  for (const request of pending) {
    if (!upcoming.has(request.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
  // Expo Go lacks both the iOS floating calendar module and the Android time-zone receiver.
  // Refresh its pending morning trigger on resume if the device's time zone changed.
  const appleCalendar =
    Platform.OS === 'ios'
      ? requireOptionalNativeModule<ReceiptReminderCalendar>('ReceiptReminderCalendar')
      : null;
  const fallbackZone =
    expoGo || (Platform.OS === 'ios' && !appleCalendar)
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  for (const reminder of upcoming.values()) {
    if (reminder.dueAt <= Date.now()) continue;
    const content = reminderContent(
      reminder.drafts,
      reminder.morningDate,
      reminder.morningDate ? fallbackZone : undefined,
    );
    const request = requests.get(reminder.identifier);
    if (
      !request ||
      request.content.body !== content.body ||
      request.content.data?.draftIds !== content.data.draftIds ||
      request.content.data?.scheduledZone !== content.data.scheduledZone
    ) {
      if (appleCalendar && reminder.morningDate) {
        await appleCalendar.schedule(
          reminder.identifier,
          reminder.morningDate,
          content.title,
          content.body,
          content.data,
        );
      } else {
        await Notifications.scheduleNotificationAsync({
          identifier: reminder.identifier,
          content,
          trigger: triggerFor(reminder),
        });
      }
    }
  }
  if (JSON.stringify(previous) !== JSON.stringify(state)) {
    const next = new File(Paths.document, 'receipt-reminder-mornings-next.json');
    next.writeSync(JSON.stringify(state));
    next.moveSync(file, { overwrite: true });
  }
}

let revision = 0;
let queue = Promise.resolve();
export function syncReceiptReminders(): Promise<void> {
  if (!native()) return Promise.resolve();
  const current = ++revision;
  // Always read the latest durable inbox inside the queue. Older writes cannot undo a discard.
  const work = queue.then(async () => {
    if (current === revision) await reconcile();
  });
  queue = work.catch(() => {});
  return work;
}
