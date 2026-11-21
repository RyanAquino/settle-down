import { act, render, screen, userEvent } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import ReceiptInboxScreen from '@/app/inbox';
import { listDrafts, removeDraft, type ReceiptDraft } from '@/utils/receipt-inbox';

import {
  getReminderPermissionSnapshot,
  openReminderSettings,
} from '@/utils/receipt-reminder-lifecycle';

jest.mock('@/utils/receipt-reminders', () => ({ scheduleVerificationReceiptReminder: jest.fn() }));
jest.mock('@/utils/receipt-reminder-lifecycle', () => ({
  subscribeReminderPermission: () => () => {},
  getReminderPermissionSnapshot: jest.fn(),
  openReminderSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/utils/receipt-inbox', () => ({
  listDrafts: jest.fn(),
  removeDraft: jest.fn(),
  draftPhotoUri: (draft: ReceiptDraft) => 'file:///' + draft.id,
}));
const photo: ReceiptDraft = {
  id: 'a',
  createdAt: 1,
  photoName: 'photo.jpg',
  receipt: null,
  edits: null,
};
const split: ReceiptDraft = {
  ...photo,
  id: 'b',
  receipt: {
    receipt_items: [],
    en_shop_name: 'Dinner',
    jp_shop_name: '',
    tax_percentage: 0,
    total_amount: 0,
    receipt_date: new Date(),
  },
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(getReminderPermissionSnapshot).mockReturnValue('undetermined');
  jest.mocked(listDrafts).mockReturnValue([photo, split]);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([
  ['Scan receipt, Receipt photo', '/loading', photo.id],
  ['Continue split, Dinner', '/receipt-details', split.id],
])('opening %s routes to its saved draft', async (name, pathname, id) => {
  const user = userEvent.setup();
  await render(<ReceiptInboxScreen />);
  await user.press(screen.getByRole('button', { name }));
  expect(router.push).toHaveBeenCalledWith({
    pathname,
    params: { draftId: id, photoUri: 'file:///' + id },
  });
});

test('discard asks for confirmation and removes just the chosen draft', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const user = userEvent.setup();
  await render(<ReceiptInboxScreen />);
  await user.press(screen.getByRole('button', { name: 'Discard Dinner' }));
  expect(removeDraft).not.toHaveBeenCalled();
  jest.mocked(listDrafts).mockReturnValue([photo]);
  await act(() => {
    alert.mock.calls[0][2]?.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(removeDraft).toHaveBeenCalledWith(split.id);
  expect(screen.queryByText('Dinner')).toBeNull();
  expect(screen.getByText('Receipt photo')).toBeOnTheScreen();
});

test('a stale reminder opens the inbox with a brief notice and denied permissions link to settings', async () => {
  jest.mocked(getReminderPermissionSnapshot).mockReturnValue('denied');
  jest.mocked(useLocalSearchParams).mockReturnValue({ missingReceipt: 'tap-a' });
  await render(<ReceiptInboxScreen />);
  const message = 'This receipt is no longer in your inbox.';
  expect(screen.getByText(message)).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Enable reminders' }));
  expect(openReminderSettings).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(5000));
  expect(screen.queryByText(message)).toBeNull();
  expect(screen.getByText('Dinner')).toBeOnTheScreen();
});
