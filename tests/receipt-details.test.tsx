import { fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import sugi from '../tools/verify-ios/fixtures/sugi-receipt.json';
import { Alert, Share } from 'react-native';
import * as api from '@/utils/api';
import ReceiptDetailsScreen from '../app/receipt-details';

jest.mock('@/utils/receipt-reminder-lifecycle', () => ({
  setActiveReceiptDraft: jest.fn(),
  receiptLeftForLater: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useLocalSearchParams: jest.fn(),
  usePreventRemove: jest.fn(),
  router: { back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const response = (items: unknown[]) =>
  ({ ok: true, json: () => Promise.resolve({ items }) }) as Response;

test('the itemized preview can be shared before choosing a payer and sync rejects mismatched edits', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ useMockData: 'true' });
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
  expect(
    within(screen.getByTestId('receipt-item-4')).getByText('¥240 paid · ¥30 saved'),
  ).toBeOnTheScreen();
  expect(screen.getAllByText(/saved/)).toHaveLength(1);
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
  expect(screen.getByText(/The items and tax must match the scanned total/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('item-cost-1'), '172,50');
  await fireEvent.changeText(screen.getByTestId('item-cost-2'), '158,50');
  expect(screen.getByTestId('sync-transaction')).toBeEnabled();
  await fireEvent.changeText(screen.getByTestId('receipt-tax'), '8junk');
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  expect(
    screen.getByText('Enter amounts as numbers without grouping separators.'),
  ).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('receipt-tax'), '8,0');
  expect(screen.getByTestId('sync-transaction')).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('scanned savings use plain amounts without a currency and follow edits to the paid price', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    data: JSON.stringify({
      receipt_items: [
        {
          english_name: 'Rice',
          japanese_name: '米',
          item_order: 1,
          cost: 600,
          quantity: 2,
          discount: 100,
        },
        { english_name: 'Tea', japanese_name: 'お茶', item_order: 2, cost: 80, quantity: 1 },
      ],
      en_shop_name: 'Market',
      jp_shop_name: '市場',
      tax_percentage: 0,
      total_amount: 680,
      receipt_date: '2026-11-16T00:00:00Z',
    }),
  });
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response([]));

  await render(<ReceiptDetailsScreen />);
  const rice = within(screen.getByTestId('receipt-item-1'));
  expect(rice.getByText('600 paid · 100 saved')).toBeOnTheScreen();
  expect(within(screen.getByTestId('receipt-item-2')).queryByText(/saved/)).toBeNull();

  await fireEvent.changeText(rice.getByLabelText('Cost of Rice'), '580');
  expect(rice.getByText('580 paid · 100 saved')).toBeOnTheScreen();
});

test('a build without a backend URL keeps receipt details local', async () => {
  jest.replaceProperty(api, 'apiBaseUrl', undefined);
  jest.mocked(useLocalSearchParams).mockReturnValue({ useMockData: 'true' });
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response([]));

  await render(<ReceiptDetailsScreen />);

  expect(screen.getByText('This build is missing its backend URL.')).toBeOnTheScreen();
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});

test('Sugi coupon and points reach the summary, share preview and exact Settle Up payment', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ data: JSON.stringify(sugi) });
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response([{ id: 'group', name: 'Japan', currency: 'JPY' }]))
    .mockResolvedValueOnce(
      response([
        { id: 'aya', name: 'Aya' },
        { id: 'ren', name: 'Ren' },
      ]),
    )
    .mockResolvedValueOnce({ status: 201, ok: true } as Response);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  const user = userEvent.setup();
  await render(<ReceiptDetailsScreen />);
  await user.press(await screen.findByTestId('paid-by-aya'));
  for (const [i, control] of [
    'assign-aya',
    'assign-ren',
    'assign-aya',
    'assign-ren',
    'shared',
    'shared',
  ].entries()) {
    await user.press(screen.getByTestId(`item-${i + 1}-${control}`));
  }
  for (const value of [
    '¥6,536',
    '¥6,303',
    'Item discount · ¥347',
    'Item discount · ¥294',
    'Receipt discount',
    '-¥233',
    'Points redeemed',
    '-¥494',
    'Tax added',
  ]) {
    expect(screen.getByText(value)).toBeOnTheScreen();
  }
  expect(screen.getByTestId('receipt-total')).toHaveTextContent('¥5,809');
  await user.press(screen.getByTestId('show-my-share'));
  await user.press(screen.getByTestId('share-member-aya'));
  expect(screen.getByText('¥837')).toBeOnTheScreen();
  await user.press(screen.getByTestId('share-receipt-breakdown'));
  const [{ message }] = share.mock.calls[0];
  expect(message).toContain('Aya · Estimated share ¥3,089');
  expect(message).toContain('Ren · Estimated share ¥2,720');
  expect(message).toContain('Item shares include receipt deductions');
  await user.press(screen.getByRole('button', { name: 'Close' }));
  await fireEvent.changeText(screen.getByTestId('item-cost-1'), '988');
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('item-cost-1'), '987');
  await user.press(screen.getByTestId('sync-transaction'));
  expect(alert).toHaveBeenCalledWith('Synced', expect.any(String), expect.any(Array));
  const body = fetch.mock.calls[2][1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON transaction body');
  expect(JSON.parse(body)).toMatchObject({
    total_amount: 5809,
    tax_percentage: 0,
    split_receipt_items: [],
    user_receipt_items: [
      { member_id: 'aya', cost: 3089 },
      { member_id: 'ren', cost: 2720 },
    ],
  });
});
