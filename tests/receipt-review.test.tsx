import { render, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { uuid } from 'expo';
import { randomUUID } from 'node:crypto';
import { Alert } from 'react-native';
import ReceiptDetailsScreen from '@/app/receipt-details';
import { readReceipt } from '@/utils/receipt';
import { createPhotoDraft, readDraft, saveDraft } from '@/utils/receipt-inbox';
import { samplePhoto, setupInboxFiles } from './support/inbox-files';
import {
  finalCosts,
  mismatchScan,
  reconciledAllocation,
  reconciledScan,
  reviewScan,
} from './support/sugi-receipt';

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
jest.mock('@react-native-community/datetimepicker', () => () => null);

setupInboxFiles();
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(uuid, 'v4').mockImplementation(randomUUID);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;

const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
// Every JSON request body this screen sends is a string.
const bodyOf = (init: RequestInit | undefined): unknown =>
  JSON.parse(typeof init?.body === 'string' ? init.body : 'null');

// The backend: one JPY group of two, and a recalculation endpoint per test.
function backend(allocate: (body: Record<string, unknown>) => Response) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOf(input);
    if (url.includes('/settle-up/groups/'))
      return Promise.resolve(json({ items: [{ id: 'home', name: 'Home', currency: 'JPY' }] }));
    if (url.includes('/settle-up/users/'))
      return Promise.resolve(
        json({
          items: [
            { id: 'aya', name: 'Aya' },
            { id: 'ren', name: 'Ren' },
          ],
        }),
      );
    if (url.includes('/receipts/allocations/'))
      return Promise.resolve(allocate(bodyOf(init) as Record<string, unknown>));
    if (url.includes('/settle-up/transactions/')) return Promise.resolve(json(null, 204));
    return Promise.reject(new Error(`Unexpected request ${url}`));
  });
}

const requestsTo = (fetch: jest.SpiedFunction<typeof globalThis.fetch>, path: string) =>
  fetch.mock.calls.filter(([input]) => urlOf(input).includes(path));

async function openWith(scan: unknown) {
  jest.mocked(useLocalSearchParams).mockReturnValue({ data: JSON.stringify(scan) });
  await render(<ReceiptDetailsScreen />);
  await screen.findByTestId('paid-by-aya');
}

async function assignAllTo(user: ReturnType<typeof userEvent.setup>, member: string) {
  for (let order = 1; order <= 6; order++) {
    await user.press(screen.getByTestId(`item-${order}-assign-${member}`));
  }
  await user.press(screen.getByTestId(`paid-by-${member}`));
}

test('a line the receipt does not settle blocks the split until a person places it', async () => {
  const fetch = backend(() => json(reconciledAllocation));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const user = userEvent.setup();
  await openWith(reviewScan);

  expect(
    screen.getByText('Choose the items this line covers. The receipt doesn’t say.'),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('item-printed-price-3')).toHaveTextContent('¥2,310');
  expect(screen.queryByTestId('item-cost-3')).toBeNull();
  await assignAllTo(user, 'aya');
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  expect(screen.getByText('Review the discounts and points.')).toBeOnTheScreen();
  expect(screen.getByTestId('show-my-share')).toBeDisabled();

  // The doubtful line opens with nothing chosen; the printed 15% points at item 4.
  await user.press(screen.getByTestId('adjustment-1'));
  expect(screen.getByTestId('adjustment-done')).toBeDisabled();
  expect(screen.getByText('¥1,958 · 15% matches')).toBeOnTheScreen();
  await user.press(screen.getByTestId('adjustment-item-4'));
  await user.press(screen.getByTestId('adjustment-done'));

  expect(await screen.findByTestId('item-cost-3')).toHaveDisplayValue('1809');
  const [[, init]] = requestsTo(fetch, '/receipts/allocations/');
  const body = bodyOf(init) as {
    adjustments: { item_orders: number[]; status?: string }[];
  };
  expect(body.adjustments.map(({ item_orders }) => item_orders)).toEqual([
    [3],
    [4],
    [1, 2, 5, 6],
    [1, 2, 3, 4, 5, 6],
  ]);
  expect(body.adjustments[1]).not.toHaveProperty('status');
  expect(
    within(screen.getByTestId('receipt-item-3')).getByText('¥1,809 paid · ¥501 saved'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Choose items')).toBeNull();

  await waitFor(() => expect(screen.getByTestId('sync-transaction')).toBeEnabled());
  await user.press(screen.getByTestId('sync-transaction'));
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith('Synced', expect.any(String), expect.any(Array)),
  );
  const [[, sync]] = requestsTo(fetch, '/settle-up/transactions/');
  const filed = bodyOf(sync) as {
    total_amount: number;
    user_receipt_items: { member_id: string; cost: number }[];
  };
  expect(filed.total_amount).toBe(5809);
  expect(filed.user_receipt_items).toEqual([
    { member_id: 'aya', cost: finalCosts.reduce((sum, cost) => sum + cost, 0) },
  ]);
});

test('a reconciled receipt lists each line, marking the ones a person should check', async () => {
  backend(() => json(reconciledAllocation));
  await openWith(reconciledScan);

  const card = within(screen.getByTestId('receipt-adjustments'));
  expect(card.getByText('Discount · Amino Moist')).toBeOnTheScreen();
  expect(card.getByText('Discount · Dry shampoo, Nose strips +2 more')).toBeOnTheScreen();
  expect(card.getByText('Points · Whole receipt')).toBeOnTheScreen();
  expect(card.getByText('−¥494')).toBeOnTheScreen();
  expect(card.getAllByText('Check items')).toHaveLength(1);
  expect(card.queryByTestId('receipt-adjustments-notice')).toBeNull();
  expect(screen.getByTestId('item-cost-1')).toHaveDisplayValue('837');
  expect(screen.getByText('Tax included')).toBeOnTheScreen();
});

test('a correction the server cannot apply keeps the edit, explains why and can be retried', async () => {
  let reject = true;
  const fetch = backend(() =>
    reject
      ? json({ detail: "'スギポイント値引金額' is larger than what its items still cost." }, 422)
      : json(reconciledAllocation),
  );
  const user = userEvent.setup();
  await openWith(reconciledScan);
  await assignAllTo(user, 'ren');
  expect(screen.getByTestId('sync-transaction')).toBeEnabled();

  await user.press(screen.getByTestId('adjustment-3'));
  await user.press(screen.getByTestId('adjustment-all-items'));
  await user.press(screen.getByTestId('adjustment-item-6'));
  await user.press(screen.getByTestId('adjustment-done'));

  expect(
    await screen.findByText(
      "'スギポイント値引金額' is larger than what its items still cost. Try again",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('sync-transaction')).toBeDisabled();
  expect(screen.getByTestId('item-printed-price-1')).toHaveTextContent('¥987');

  reject = false;
  await user.press(screen.getByTestId('recalculate'));
  expect(await screen.findByTestId('item-cost-1')).toHaveDisplayValue('837');
  expect(requestsTo(fetch, '/receipts/allocations/')).toHaveLength(2);
  await waitFor(() => expect(screen.getByTestId('sync-transaction')).toBeEnabled());
});

test('a receipt that does not add up is fixed by adding the line that was missed', async () => {
  const fetch = backend((body) => {
    const lines = body.adjustments as { kind: string; amount: number; item_orders: number[] }[];
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatchObject({
      kind: 'points',
      amount: 494,
      item_orders: [1, 2, 3, 4, 5, 6],
    });
    return json(reconciledAllocation);
  });
  const user = userEvent.setup();
  await openWith(mismatchScan);

  expect(
    screen.getByText(
      'These lines leave ¥494 unaccounted for. Compare them with the photo, or add one that’s missing.',
    ),
  ).toBeOnTheScreen();
  await user.press(screen.getByTestId('add-adjustment'));
  await user.press(screen.getByTestId('adjustment-kind-points'));
  await user.type(screen.getByTestId('adjustment-label'), 'Points');
  await user.type(screen.getByTestId('adjustment-amount'), '494');
  await user.press(screen.getByTestId('adjustment-done'));

  expect(await screen.findByTestId('item-cost-6')).toHaveDisplayValue('236');
  expect(requestsTo(fetch, '/receipts/allocations/')).toHaveLength(1);
  expect(screen.queryByText(/unaccounted for/)).toBeNull();
});

test('placed lines and their recalculation reopen from the inbox', async () => {
  backend(() => json(reconciledAllocation));
  const user = userEvent.setup();
  const draft = await createPhotoDraft(samplePhoto().uri);
  const receipt = readReceipt(reviewScan);
  if (!receipt) throw new Error('fixture did not parse');
  saveDraft({ ...draft, receipt });
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id });

  const { unmount } = await render(<ReceiptDetailsScreen />);
  await screen.findByTestId('paid-by-aya');
  await user.press(screen.getByTestId('adjustment-1'));
  await user.press(screen.getByTestId('adjustment-item-4'));
  await user.press(screen.getByTestId('adjustment-done'));
  await screen.findByTestId('item-cost-3');
  await unmount();

  const saved = readDraft(draft.id);
  expect(saved?.edits?.allocation?.reconciliation.status).toBe('reconciled');
  expect(saved?.edits?.adjustments?.[1].item_orders).toEqual([4]);
  await render(<ReceiptDetailsScreen />);
  expect(await screen.findByTestId('item-cost-3')).toHaveDisplayValue('1809');
  expect(screen.queryByText('Choose items')).toBeNull();
});
