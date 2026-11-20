import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Share } from 'react-native';
import ReceiptDetailsScreen from '../app/receipt-details';

jest.mock('@/components/account', () => ({
  useAccount: () => ({ request: globalThis.fetch }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ useMockData: 'true' }),
  router: { back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);

afterEach(() => {
  jest.restoreAllMocks();
});

test('the itemized preview can be shared before choosing a payer and sync rejects mismatched edits', async () => {
  const response = (items: unknown[]) =>
    ({ ok: true, json: () => Promise.resolve({ items }) }) as Response;
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response([{ id: 'group', name: 'Dinner', currency: 'JPY' }]))
    .mockResolvedValueOnce(
      response([
        { id: 'aya', name: 'Aya' },
        { id: 'ren', name: 'Ren' },
      ]),
    );
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  const user = userEvent.setup();

  await render(<ReceiptDetailsScreen />);
  await screen.findByTestId('paid-by-aya');
  expect(screen.getByTestId('show-my-share')).toBeDisabled();

  await user.press(screen.getByTestId('item-1-assign-aya'));
  await user.press(screen.getByTestId('item-2-assign-ren'));
  await user.press(screen.getByTestId('item-3-shared'));
  await user.press(screen.getByTestId('item-4-split'));
  await user.press(screen.getByTestId('split-mode-quantity'));
  await user.press(screen.getByTestId('split-add-aya'));
  await user.press(screen.getByTestId('split-add-ren'));
  await user.press(screen.getByTestId('split-done'));

  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  await user.press(screen.getByTestId('show-my-share'));
  expect(screen.getByText('Receipt total · ¥756')).toBeOnTheScreen();
  await user.press(screen.getByTestId('share-member-aya'));
  expect(screen.getByText('Onigiri · ×1')).toBeOnTheScreen();
  await user.press(screen.getByTestId('share-receipt-breakdown'));
  expect(share).toHaveBeenCalledTimes(1);
  const [{ message }] = share.mock.calls[0];
  expect(message).toContain('Receipt total ¥756');
  expect(message).toContain('Aya · Estimated share');
  expect(message).toContain('Ren · Estimated share');
  expect(message).toContain('Onigiri · ×1 · ¥120');

  await user.press(screen.getByRole('button', { name: 'Close' }));
  await user.press(screen.getByTestId('paid-by-aya'));
  expect(screen.getByTestId('sync-transaction')).toBeEnabled();
  await fireEvent.changeText(screen.getByTestId('item-cost-1'), '100');
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  expect(screen.getByText('The items and tax must match the scanned total.')).toBeOnTheScreen();
  expect(fetch).toHaveBeenCalledTimes(2);
});
