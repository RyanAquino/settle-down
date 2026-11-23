import { previewReceipt, reconcileReceipt } from '../utils/receipt-preview';
import sugi from '../tools/verify-ios/fixtures/sugi-receipt.json';
import { readReceipt, type ReceiptAdjustment, type ReceiptItem } from '../utils/receipt';

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

test('the six Sugi lines verify only after the eligible basket coupon and redeemed points', () => {
  const receipt = readReceipt(sugi)!;
  const { receipt_items: items, receipt_adjustments: adjustments, total_amount: total } = receipt;
  const result = reconcileReceipt(items, 0, total, adjustments);
  expect(result).toMatchObject({ subtotal: 6536, taxAmount: 0, total: 5809 });
  expect(result?.adjustedItems?.map((item) => item.cost)).toEqual([837, 744, 1809, 1533, 650, 236]);
  expect(reconcileReceipt([...items].reverse(), 10, total, adjustments)).toEqual(result);
  expect(items.map((item) => item.cost)).toEqual([987, 877, 1963, 1664, 767, 278]);
  expect(reconcileReceipt(items, 10, total)).toBeNull();
  expect(reconcileReceipt(items, 10, total, adjustments?.slice(0, 1))).toBeNull();
  expect(reconcileReceipt(items, 10, total + 1, adjustments)).toBeNull();
});

test('tax is added after a pre-tax coupon, and points pay down the resulting bill', () => {
  const items = [
    { ...item, cost: 10 },
    { ...item, item_order: 2, cost: 3 },
  ];
  const adjustments: ReceiptAdjustment[] = [
    { kind: 'points_redemption', amount: 3, item_orders: [] },
    { kind: 'discount', amount: 1.25, item_orders: [1] },
  ];
  // 13 - 1.25 = 11.75, plus 0.94 tax, minus 3 in points.
  const result = reconcileReceipt(items, 8, 9.69, adjustments);
  expect(result?.taxAmount).toBe(0.94);
  expect(result?.adjustedItems?.map((line) => line.cost)).toEqual([7.22, 2.47]);
});

test('deductions cannot exceed eligible prices or reference duplicate or missing items', () => {
  const items = [item, { ...item, item_order: 2 }];
  for (const orders of [[1], [1, 1], [99]]) {
    expect(
      reconcileReceipt(items, 0, 50, [{ kind: 'discount', amount: 150, item_orders: orders }]),
    ).toBeNull();
  }
});

test('points covering the entire taxed purchase yield zero shares', () => {
  const balance = reconcileReceipt([item], 10, 0, [
    { kind: 'points_redemption', amount: 110, item_orders: [] },
  ]);
  expect(balance?.adjustedItems?.[0].cost).toBe(0);
  expect(
    previewReceipt([item], { 1: 'a' }, [{ id: 'a', name: 'A' }], 'JPY', balance!)[0],
  ).toMatchObject({ total: 0, rounding: 0 });
});
