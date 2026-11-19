import { previewReceipt, reconcileReceipt } from '../utils/receipt-preview';
import type { ReceiptItem } from '../utils/receipt';

const item: ReceiptItem = {
  english_name: 'Gyoza',
  japanese_name: '餃子',
  item_order: 1,
  quantity: 1,
  cost: 100,
  discount: 0,
};

test('reconciles tax included in prices, rounded whole-yen tax, and cents', () => {
  expect(reconcileReceipt([item], 10, 100)).toEqual({
    subtotal: 100,
    taxAmount: 0,
    total: 100,
  });
  expect(reconcileReceipt([{ ...item, cost: 697 }], 8, 753)).toEqual({
    subtotal: 697,
    taxAmount: 56,
    total: 753,
  });
  expect(reconcileReceipt([{ ...item, cost: 4.25 }], 8, 4.59)).toEqual({
    subtotal: 4.25,
    taxAmount: 0.34,
    total: 4.59,
  });
  expect(reconcileReceipt([{ ...item, cost: 2920 }], 0, 3000)).toBeNull();
  expect(reconcileReceipt([{ ...item, cost: 99 }], 10, 110)).toBeNull();
});

test('keeps whole-group shares even while the person and receipt totals reconcile', () => {
  const users = [
    { id: 'aya', name: 'Aya' },
    { id: 'ren', name: 'Ren' },
    { id: 'kei', name: 'Kei' },
  ];
  const items = [item, { ...item, item_order: 2 }];
  const result = previewReceipt(items, { 1: 'shared', 2: 'shared' }, users, 'JPY', {
    subtotal: 200,
    taxAmount: 20,
    total: 220,
  });

  expect(result.map(({ total }) => total)).toEqual([74, 73, 73]);
  expect(result.reduce((sum, share) => sum + share.taxAmount, 0)).toBe(20);
  expect(result[0].lines[0]).toMatchObject({ name: 'Gyoza', portion: '1 of 3 shares', amount: 33 });
  for (const { lines, taxAmount, rounding, total } of result) {
    expect(lines.reduce((sum, line) => sum + line.amount, 0) + taxAmount + rounding).toBe(total);
  }
});

test('quantity previews use the same rounded line allocations as sync', () => {
  const beer = { ...item, english_name: 'Beer', cost: 10, quantity: 3 };
  const result = previewReceipt(
    [beer],
    {
      1: {
        mode: 'quantity',
        portions: [
          { memberId: 'aya', units: 1 },
          { memberId: 'ren', units: 2 },
        ],
      },
    },
    [
      { id: 'aya', name: 'Aya' },
      { id: 'ren', name: 'Ren' },
      { id: 'kei', name: 'Kei' },
    ],
    'USD',
    { subtotal: 10, taxAmount: 1, total: 11 },
  );
  expect(result).toMatchObject([
    { user: { id: 'aya' }, lines: [{ portion: '×1', amount: 3.33 }], taxAmount: 0.33, total: 3.66 },
    { user: { id: 'ren' }, lines: [{ portion: '×2', amount: 6.67 }], taxAmount: 0.67, total: 7.34 },
  ]);
});
