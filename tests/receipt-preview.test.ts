import { previewReceipt, pricesBeforeDeduction, reconcileReceipt } from '../utils/receipt-preview';
import sugi from '../tools/verify-ios/fixtures/sugi-receipt.json';
import { readReceipt, type ReceiptItem } from '../utils/receipt';

const item: ReceiptItem = {
  english_name: 'Gyoza',
  japanese_name: '餃子',
  item_order: 1,
  quantity: 1,
  cost: 100,
  discount: 0,
};

function plainReceipt(receipt_items: ReceiptItem[], tax_percentage: number, total_amount: number) {
  return {
    receipt_items,
    tax_percentage,
    total_amount,
    receipt_discount: 0,
    points_redeemed: 0,
    split_rules: { discounts: [], points: [] },
  };
}

test('reconciles tax included in prices, rounded whole-yen tax, and cents', () => {
  expect(reconcileReceipt(plainReceipt([item], 10, 100))).toEqual({
    subtotal: 100,
    taxAmount: 0,
    total: 100,
  });
  expect(reconcileReceipt(plainReceipt([{ ...item, cost: 697 }], 8, 753))).toEqual({
    subtotal: 697,
    taxAmount: 56,
    total: 753,
  });
  expect(reconcileReceipt(plainReceipt([{ ...item, cost: 4.25 }], 8, 4.59))).toEqual({
    subtotal: 4.25,
    taxAmount: 0.34,
    total: 4.59,
  });
  expect(reconcileReceipt(plainReceipt([{ ...item, cost: 2920 }], 0, 3000))).toBeNull();
  expect(reconcileReceipt(plainReceipt([{ ...item, cost: 99 }], 10, 110))).toBeNull();
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
  const { receipt_items: items } = receipt;
  const result = reconcileReceipt(receipt);
  expect(result).toMatchObject({ subtotal: 6536, taxAmount: 0, total: 5809 });
  expect(result?.adjustedItems?.map((item) => item.cost)).toEqual([837, 744, 1809, 1533, 650, 236]);
  expect(reconcileReceipt({ ...receipt, receipt_items: [...items].reverse() })).toEqual(result);
  expect(items.map((item) => item.cost)).toEqual([987, 877, 1963, 1664, 767, 278]);
  expect(reconcileReceipt({ ...receipt, receipt_discount: 0 })).toBeNull();
  expect(reconcileReceipt({ ...receipt, points_redeemed: 0 })).toBeNull();
  expect(reconcileReceipt({ ...receipt, total_amount: 5810 })).toBeNull();
});

test('tax is added after a pre-tax coupon, and points pay down the resulting bill', () => {
  const items = [
    { ...item, cost: 10 },
    { ...item, item_order: 2, cost: 3 },
  ];
  // 13 - 1.25 = 11.75, plus 0.94 tax, minus 3 in points.
  const result = reconcileReceipt({
    ...plainReceipt(items, 8, 9.69),
    receipt_discount: 1.25,
    points_redeemed: 3,
    split_rules: {
      discounts: [{ amount: 1.25, item_orders: [1] }],
      points: [{ scope: 'basket', amount: 3, item_orders: [] }],
    },
  });
  expect(result?.taxAmount).toBe(0.94);
  expect(result?.adjustedItems?.map((line) => line.cost)).toEqual([7.22, 2.47]);
});

test('deductions cannot exceed eligible prices or reference duplicate or missing items', () => {
  const items = [item, { ...item, item_order: 2 }];
  for (const orders of [[1], [1, 1], [99]]) {
    expect(
      reconcileReceipt({
        ...plainReceipt(items, 0, 50),
        receipt_discount: 150,
        split_rules: { discounts: [{ amount: 150, item_orders: orders }], points: [] },
      }),
    ).toBeNull();
  }
});

test('points covering the entire taxed purchase yield zero shares', () => {
  const balance = reconcileReceipt({
    ...plainReceipt([item], 10, 0),
    points_redeemed: 110,
    split_rules: { discounts: [], points: [{ scope: 'basket', amount: 110, item_orders: [] }] },
  });
  expect(balance?.adjustedItems?.[0].cost).toBe(0);
  expect(
    previewReceipt([item], { 1: 'a' }, [{ id: 'a', name: 'A' }], 'JPY', balance!)[0],
  ).toMatchObject({ total: 0, rounding: 0 });
});

test('overlapping coupons and scoped points use printed order and round each deduction once', () => {
  const items = [item, { ...item, item_order: 2 }, { ...item, item_order: 3 }];
  const result = reconcileReceipt({
    ...plainReceipt(items, 0, 256),
    receipt_discount: 41,
    points_redeemed: 3,
    split_rules: {
      discounts: [
        { amount: 21, item_orders: [1, 2] },
        { amount: 20, item_orders: [2, 3] },
      ],
      points: [
        { amount: 2, item_orders: [3] },
        { amount: 1, item_orders: [] },
      ],
    },
  });
  expect(result?.adjustedItems?.map(({ cost }) => cost)).toEqual([88, 81, 87]);
});

test('an explicit whole-basket coupon splits proportionally', () => {
  const items = [item, { ...item, item_order: 2 }];
  const receipt = {
    ...plainReceipt(items, 0, 172),
    receipt_discount: 25,
    points_redeemed: 3,
    split_rules: {
      discounts: [{ amount: 25, scope: 'basket' as const, item_orders: [] }],
      points: [{ amount: 3, scope: 'basket' as const, item_orders: [] }],
    },
  };
  expect(reconcileReceipt(receipt)?.adjustedItems?.map(({ cost }) => cost)).toEqual([86, 86]);
  expect(
    reconcileReceipt({
      ...receipt,
      split_rules: { discounts: [], points: [{ amount: 4, item_orders: [1] }] },
    }),
  ).toBeNull();
});

test('review uses the running eligible prices for overlapping coupons', () => {
  const items = [item, { ...item, item_order: 2, cost: 90 }];
  const receipt = {
    ...plainReceipt(items, 0, 175),
    receipt_discount: 15,
    split_rules: {
      discounts: [
        { amount: 10, item_orders: [1] },
        { amount: 5, scope: 'needs_review' as const, item_orders: [], eligible_subtotal: 90 },
      ],
      points: [],
    },
  };
  expect(pricesBeforeDeduction(receipt, 'discounts', 1, 'JPY')?.map((i) => i.cost)).toEqual([
    90, 90,
  ]);
  expect(reconcileReceipt(receipt)).toBeNull();
});

test('an old checkout deduction without eligibility opens for confirmation while a points-only receipt balances', () => {
  const old = { ...sugi, split_rules: undefined };
  const receipt = readReceipt(old)!;
  expect(receipt.split_rules.discounts[0].scope).toBe('needs_review');
  expect(receipt.split_rules.points[0].scope).toBe('basket');
  expect(reconcileReceipt(receipt)).toBeNull();
});

test('an item reduced to zero by its coupon stays reviewable', () => {
  expect(
    reconcileReceipt(plainReceipt([{ ...item, cost: 0, discount: 100 }], 0, 0), 'JPY'),
  ).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
});
