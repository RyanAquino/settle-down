import { act, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { pendingScan } from '@/utils/scan-request';
import { Alert } from 'react-native';
import ReceiptInboxScreen from '@/app/inbox';
import { listDrafts, removeDraft, type ReceiptDraft } from '@/utils/receipt-inbox';

jest.mock('expo-router', () => ({
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
  jest.mocked(listDrafts).mockReturnValue([photo, split]);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('opening a queued receipt prepares a scan for its saved draft', async () => {
  const user = userEvent.setup();
  await render(<ReceiptInboxScreen />);
  await user.press(screen.getByRole('button', { name: 'Scan receipt, Receipt photo' }));
  const target = jest.mocked(router.push).mock.calls[0][0];
  expect(target).toHaveProperty('pathname', '/loading');
  if (typeof target === 'string') throw new Error('Expected a route with a scan ID');
  expect(pendingScan(String(target.params?.scanId))).toEqual({
    draftId: photo.id,
    photoUri: 'file:///' + photo.id,
  });
});

test('opening an edited receipt routes straight to its saved split', async () => {
  const user = userEvent.setup();
  await render(<ReceiptInboxScreen />);
  await user.press(screen.getByRole('button', { name: 'Continue split, Dinner' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/receipt-details',
    params: { draftId: split.id },
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
