import type * as Notifications from 'expo-notifications';
import { parseReceiptReminder } from '@/utils/receipt-reminders';

// The simulator can miss a transient banner while Maestro is inspecting the open app.
// Publish the decision only after Expo confirms that iOS handled this exact request.
type ObservedDelivery = { identifier: string; openDraftId: string; description: string };
const listeners = new Set<(delivery: ObservedDelivery) => void>();

export function subscribeToVerifiedDeliveries(listener: (delivery: ObservedDelivery) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function observeReminderPresentation(
  handler: Notifications.NotificationHandler,
  currentDraft: () => string | null,
): Notifications.NotificationHandler {
  const pending = new Map<string, ObservedDelivery>();
  return {
    async handleNotification(notification) {
      const openDraftId = currentDraft();
      const behavior = await handler.handleNotification(notification);
      const { identifier, content } = notification.request;
      const reminder = parseReceiptReminder(content.data);
      if (openDraftId && reminder) {
        const { draftIds } = reminder;
        const action = behavior.shouldShowBanner ? 'Presented' : 'Suppressed';
        const receiptCount = draftIds.length === 1 ? '1 receipt' : `${draftIds.length} receipts`;
        const includesOpen = draftIds.includes(openDraftId) ? 'including' : 'excluding';
        pending.set(identifier, {
          identifier,
          openDraftId,
          description: `${action} ${receiptCount} ${includesOpen} this receipt`,
        });
      }
      return behavior;
    },
    handleSuccess(identifier) {
      const delivery = pending.get(identifier);
      if (delivery) {
        pending.delete(identifier);
        for (const listener of listeners) listener(delivery);
      }
    },
    handleError(identifier) {
      pending.delete(identifier);
    },
  };
}
