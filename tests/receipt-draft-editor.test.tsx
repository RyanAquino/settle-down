import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { uuid } from 'expo';
import { randomUUID } from 'node:crypto';
import { receiptLeftForLater, setActiveReceiptDraft } from '@/utils/receipt-reminder-lifecycle';
import { Alert, Platform, View, ScrollView } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import ReceiptDetailsScreen from '@/app/receipt-details';
import { createPhotoDraft, readDraft, saveDraft } from '@/utils/receipt-inbox';
import { samplePhoto, setupInboxFiles } from './support/inbox-files';

jest.mock('expo-file-system', () =>
  jest.requireActual<typeof import('./support/inbox-files')>('./support/inbox-files'),
);
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
  router: { back: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Button } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    DateTimePickerAndroid: { open: jest.fn() },
    default: ({ onValueChange }: { onValueChange: (event: unknown, date: Date) => void }) =>
      createElement(Button, {
        title: 'Choose July 1',
        onPress: () => onValueChange({}, new Date('2026-07-01T12:00:00Z')),
      }),
  };
});

const groups = [
  { id: 'home', name: 'House', currency: 'USD' },
  { id: 'trip', name: 'Trip', currency: 'JPY' },
];
const members = [
  { id: 'aya', name: 'Aya' },
  { id: 'ren', name: 'Ren' },
];
const receipt = {
  receipt_discount: 0,
  points_redeemed: 0,
  split_rules: { discounts: [], points: [] },
  en_shop_name: 'Market',
  jp_shop_name: '市場',
  receipt_date: new Date('2026-06-20T12:00:00Z'),
  receipt_items: [
    {
      english_name: 'Tea',
      japanese_name: '茶',
      item_order: 8,
      cost: 110,
      quantity: 1,
      discount: 0,
    },
    {
      english_name: 'Soda',
      japanese_name: 'ソーダ',
      item_order: 12,
      cost: 190,
      quantity: 2,
      discount: 0,
    },
  ],
  tax_percentage: 0,
  total_amount: 330,
  receipt_image_url: 'https://example.com/scan.jpg',
};
const response = (items: unknown[]) =>
  ({ ok: true, json: () => Promise.resolve({ items }) }) as Response;

setupInboxFiles();
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(uuid, 'v4').mockImplementation(randomUUID);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('edits, payer and quantity splits reopen from disk and only a confirmed sync clears the draft', async () => {
  const draft = { ...(await createPhotoDraft(samplePhoto().uri)), receipt };
  saveDraft(draft);
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let submitAttempts = 0;
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('groups/'))
      return Promise.resolve(response(groups));
    if (typeof url === 'string' && url.includes('users/'))
      return Promise.resolve(response(members));
    submitAttempts++;
    if (submitAttempts === 2) return Promise.reject(new TypeError('Network request failed'));
    return Promise.resolve({
      ok: submitAttempts === 3,
      status: submitAttempts === 3 ? 204 : 422,
    } as Response);
  });
  const user = userEvent.setup();
  const first = await render(<ReceiptDetailsScreen />);
  await screen.findByTestId('paid-by-aya');
  await user.press(screen.getByTestId('receipt-group'));
  await user.press(screen.getByTestId('group-trip'));
  await user.press(await screen.findByTestId('paid-by-ren'));
  await fireEvent.changeText(screen.getByLabelText('Cost of Tea'), '100');
  await fireEvent.changeText(screen.getByLabelText('Cost of Soda'), '200');
  await fireEvent.changeText(screen.getByLabelText('Tax percentage'), '10');
  await user.press(screen.getByTestId('receipt-date'));
  await user.press(screen.getByText('Choose July 1'));
  await user.press(screen.getByText('Cancel'));
  expect(readDraft(draft.id)?.edits?.date).toBe(receipt.receipt_date.toISOString());
  await user.press(screen.getByTestId('receipt-date'));
  await user.press(screen.getByText('Choose July 1'));
  await user.press(screen.getByText('Done'));
  await user.press(screen.getByTestId('item-8-assign-aya'));
  await user.press(screen.getByTestId('item-12-split'));
  await user.press(screen.getByTestId('split-mode-quantity'));
  await user.press(screen.getByTestId('split-add-aya'));
  await user.press(screen.getByTestId('split-add-ren'));
  await user.press(screen.getByTestId('split-done'));
  await user.press(screen.getByText('Save for later'));
  expect(router.dismissTo).toHaveBeenCalledWith('/inbox');
  expect(setActiveReceiptDraft).toHaveBeenCalledWith(draft.id);
  expect(receiptLeftForLater).toHaveBeenCalledTimes(1);
  await first.unmount();

  const edited = readDraft(draft.id)?.edits;
  expect(edited).toMatchObject({
    group: groups[1],
    payer: 'ren',
    costs: { 8: '100', 12: '200' },
    tax: '10',
    date: '2026-07-01T12:00:00.000Z',
    assignments: {
      8: 'aya',
      12: {
        mode: 'quantity',
        portions: [
          { memberId: 'aya', units: 1 },
          { memberId: 'ren', units: 1 },
        ],
      },
    },
  });
  await render(<ReceiptDetailsScreen />);
  await waitFor(() => expect(screen.getByTestId('sync-transaction')).toBeEnabled());
  expect(screen.getByText('Trip')).toBeOnTheScreen();
  expect(screen.getByText('Aya ×1 · Ren ×1')).toBeOnTheScreen();
  expect(screen.getByLabelText('Cost of Soda')).toHaveDisplayValue('200');
  expect(screen.getByLabelText('Tax percentage')).toHaveDisplayValue('10');
  expect(submitAttempts).toBe(0);
  await user.press(screen.getByTestId('sync-transaction'));
  expect(alert).toHaveBeenCalledWith('Sync failed', expect.any(String));
  expect(readDraft(draft.id)?.edits).toEqual(edited);
  await user.press(screen.getByTestId('sync-transaction'));
  expect(alert).toHaveBeenCalledWith(
    'Couldn’t confirm sync',
    expect.stringContaining('Check your Settle Up group'),
  );
  expect(submitAttempts).toBe(2);
  expect(readDraft(draft.id)?.edits).toEqual(edited);
  await user.press(screen.getByTestId('sync-transaction'));
  const body = fetch.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON transaction body');
  const payload: unknown = JSON.parse(body);
  expect(payload).toMatchObject({
    group_id: 'trip',
    paying_member_id: 'ren',
    tax_percentage: 10,
    total_amount: 330,
    receipt_date: '2026-07-01T12:00:00.000Z',
    receipt_image_url: receipt.receipt_image_url,
    user_receipt_items: [
      { member_id: 'aya', cost: 200 },
      { member_id: 'ren', cost: 100 },
    ],
  });
  expect(readDraft(draft.id)).toBeNull();
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
});

test('a missing saved group keeps its edits until the user selects another available group', async () => {
  const draft = {
    ...(await createPhotoDraft(samplePhoto().uri)),
    receipt,
    edits: {
      costs: { 8: '100' },
      tax: '10',
      date: receipt.receipt_date.toISOString(),
      group: groups[1],
      members,
      payer: 'ren',
      assignments: { 8: 'aya', 12: 'shared' },
    },
  };
  saveDraft(draft);
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response([groups[0]]))
    .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    .mockResolvedValueOnce(response(members));
  const user = userEvent.setup();
  await render(<ReceiptDetailsScreen />);
  await screen.findByText('Couldn’t refresh group members. Retry');
  expect(readDraft(draft.id)?.edits).toEqual(draft.edits);
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  await user.press(screen.getByTestId('receipt-group'));
  await user.press(screen.getByTestId('group-home'));
  await waitFor(() =>
    expect(readDraft(draft.id)?.edits).toMatchObject({
      group: groups[0],
      members,
      payer: '',
      assignments: {},
      costs: { 8: '100' },
    }),
  );
});

test.each([false, true])(
  'a reminder opens the first unassigned item or the summary (all assigned=%s)',
  async (allAssigned) => {
    const draft = {
      ...(await createPhotoDraft(samplePhoto().uri)),
      receipt,
      edits: {
        costs: {},
        tax: '0',
        date: receipt.receipt_date.toISOString(),
        group: groups[0],
        members,
        payer: 'ren',
        assignments: { 8: 'aya', ...(allAssigned && { 12: 'ren' }) },
      },
    };
    saveDraft(draft);
    jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id, reminder: 'tap-a' });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(groups))
      .mockResolvedValueOnce(response(members));
    const nativeView = View.prototype as {
      measureLayout: (content: unknown, callback: (x: number, y: number) => void) => void;
    };
    const measure = jest.spyOn(nativeView, 'measureLayout').mockImplementation(function (
      this: { props: { testID?: string } },
      _content: unknown,
      measured,
    ) {
      expect(this.props.testID).toBe(allAssigned ? 'receipt-review-summary' : 'receipt-item-12');
      measured(0, this.props.testID === 'receipt-item-12' ? 500 : 900);
    });
    jest.spyOn(ScrollView.prototype, 'getInnerViewRef').mockReturnValue({});
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    await render(<ReceiptDetailsScreen />);
    await screen.findByTestId('paid-by-ren');
    expect(measure).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ y: allAssigned ? 888 : 488, animated: false });
  },
);

test('Android confirms the time before saving the date to the inbox', async () => {
  jest.setSystemTime(new Date('2026-07-02T00:00:00Z'));
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    const draft = { ...(await createPhotoDraft(samplePhoto().uri)), receipt };
    saveDraft(draft);
    jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(groups))
      .mockResolvedValueOnce(response(members));
    const open = jest.mocked(DateTimePickerAndroid.open);
    open.mockClear();
    const user = userEvent.setup();
    await render(<ReceiptDetailsScreen />);
    await screen.findByTestId('paid-by-aya');
    await user.press(screen.getByTestId('receipt-date'));
    const [datePicker] = open.mock.calls[0];
    expect(datePicker).toMatchObject({ mode: 'date', value: receipt.receipt_date });
    const day = new Date('2026-07-01T12:00:00Z');
    const event = { nativeEvent: { timestamp: day.getTime(), utcOffset: 0 } };
    datePicker.onValueChange?.(event, day);
    const [timePicker] = open.mock.calls[1];
    expect(timePicker).toMatchObject({ mode: 'time', value: day });
    expect(readDraft(draft.id)?.edits?.date).toBe(receipt.receipt_date.toISOString());

    const confirmed = new Date('2026-07-01T14:15:00Z');
    await act(() => timePicker.onValueChange?.(event, confirmed));
    expect(readDraft(draft.id)?.edits?.date).toBe(confirmed.toISOString());
  } finally {
    os.restore();
  }
});

test('confirming either equal-price item gives its owner the coupon and the draft restores that choice', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  saveDraft({
    ...draft,
    receipt: {
      ...receipt,
      receipt_items: receipt.receipt_items.map((item) => ({ ...item, cost: 100 })),
      total_amount: 180,
      receipt_discount: 20,
      split_rules: {
        discounts: [
          {
            amount: 20,
            scope: 'needs_review',
            item_orders: [],
            eligible_subtotal: 100,
            printed_label: '対象商品',
          },
        ],
        points: [],
      },
    },
  });
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('groups/'))
      return Promise.resolve(response([groups[1]]));
    if (typeof url === 'string' && url.includes('users/'))
      return Promise.resolve(response(members));
    return Promise.resolve({ ok: true, status: 201 } as Response);
  });
  const user = userEvent.setup();
  const first = await render(<ReceiptDetailsScreen />);
  await user.press(await screen.findByTestId('paid-by-aya'));
  await user.press(screen.getByTestId('item-8-assign-aya'));
  await user.press(screen.getByTestId('item-12-assign-ren'));
  expect(screen.getByTestId('show-my-share')).toBeDisabled();
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  await user.press(screen.getByTestId('edit-discounts-0'));
  expect(screen.getByTestId('deduction-save')).toBeDisabled();
  await user.press(screen.getByTestId('deduction-item-8'));
  expect(screen.getByText('Selected · ¥100 / ¥100 on receipt')).toBeOnTheScreen();
  await user.press(screen.getByTestId('deduction-save'));
  await user.press(screen.getByTestId('show-my-share'));
  expect(screen.getByTestId('share-member-aya')).toHaveTextContent(/¥80/);
  await user.press(screen.getByRole('button', { name: 'Close' }));
  await first.unmount();
  await render(<ReceiptDetailsScreen />);
  await waitFor(() => expect(screen.getByTestId('sync-transaction')).toBeEnabled());
  await user.press(screen.getByTestId('edit-discounts-0'));
  expect(screen.getByTestId('deduction-item-8')).toBeChecked();
  await user.press(screen.getByTestId('deduction-item-8'));
  await user.press(screen.getByTestId('deduction-item-12'));
  await user.press(screen.getByTestId('deduction-save'));
  await user.press(screen.getByTestId('sync-transaction'));
  const body = fetch.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON transaction body');
  expect(JSON.parse(body)).toMatchObject({
    total_amount: 180,
    user_receipt_items: [
      { member_id: 'aya', cost: 100 },
      { member_id: 'ren', cost: 80 },
    ],
  });
});

test('missing item and checkout coupons and redeemed points can be corrected against the printed payment', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  saveDraft({ ...draft, receipt: { ...receipt, total_amount: 250 } });
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response([groups[1]]))
    .mockResolvedValueOnce(response(members));
  const user = userEvent.setup();
  const first = await render(<ReceiptDetailsScreen />);
  await user.press(await screen.findByTestId('paid-by-aya'));
  await user.press(screen.getByTestId('item-8-assign-aya'));
  await user.press(screen.getByTestId('item-12-assign-aya'));
  const enter = async (id: string, amount: string) => {
    await user.press(screen.getByTestId(id));
    await fireEvent.changeText(screen.getByTestId('deduction-amount'), amount);
    await user.press(screen.getByTestId('deduction-save'));
  };
  await enter('edit-item-coupon-8', '20');
  expect(screen.getByTestId('item-cost-8')).toHaveDisplayValue('90');
  await enter('edit-item-coupon-8', '25');
  expect(screen.getByTestId('item-cost-8')).toHaveDisplayValue('85');
  expect(screen.getByText('Original ¥110 · Edit coupon')).toBeOnTheScreen();
  await enter('add-discounts', '20');
  await enter('add-points', '5');
  expect(screen.getByTestId('shopping-total')).toHaveTextContent('¥255');
  expect(screen.getByTestId('sync-transaction')).toBeEnabled();
  await first.unmount();
  await render(<ReceiptDetailsScreen />);
  expect(screen.getByTestId('item-cost-8')).toHaveDisplayValue('85');
  await user.press(screen.getByTestId('edit-points-0'));
  await user.press(screen.getByTestId('deduction-remove'));
  expect(screen.getByTestId('show-my-share')).toBeDisabled();
  expect(screen.getByText(/Difference · -¥5/)).toBeOnTheScreen();
  await user.press(screen.getByTestId('edit-item-coupon-8'));
  await user.press(screen.getByTestId('deduction-remove'));
  expect(screen.getByTestId('item-cost-8')).toHaveDisplayValue('110');
});
