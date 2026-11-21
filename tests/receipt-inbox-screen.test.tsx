import { act, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
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
