import {
  currencySymbol,
  formatMoney,
  parseReceipt,
  readReceipt,
  parseReceiptAmount,
  receiptTotals,
  splitReceipt,
  type ReceiptItem,
} from '../utils/receipt';

const items: ReceiptItem[] = [
  {
    english_name: 'Rice',
    japanese_name: 'ご飯',
    item_order: 8,
    cost: 240,
    quantity: 2,
    discount: 0,
  },
  {
    english_name: 'Tea',
    japanese_name: 'お茶',
    item_order: 2,
    cost: 100,
    quantity: 1,
    discount: 0,
  },
  {
    english_name: 'Water',
    japanese_name: '水',
    item_order: 20,
    cost: 60,
    quantity: 1,
    discount: 0,
  },
];

test('line totals already include quantity, and tax uses edited line costs', () => {
  expect(receiptTotals(items, 8)).toEqual({ subtotal: 400, taxAmount: 32 });
  expect(receiptTotals([{ ...items[0], cost: 200 }], 10)).toEqual({ subtotal: 200, taxAmount: 20 });
  expect(receiptTotals([], 8)).toEqual({ subtotal: 0, taxAmount: 0 });
});

test('assignments use item_order across reordered items and aggregate each member', () => {
  const assignments = { 8: 'alex', 2: 'shared', 20: 'alex' };
  const expected = {
    user_receipt_items: [{ member_id: 'alex', cost: 300 }],
    split_receipt_items: [100],
  };
  expect(splitReceipt(items, assignments)).toEqual(expected);
  expect(splitReceipt([...items].reverse(), assignments)).toEqual(expected);
});

test('shared-only receipts, zero costs, and missing assignments', () => {
  expect(
    splitReceipt(items, { 8: 'shared', 2: 'shared', 20: 'shared' }).user_receipt_items,
  ).toEqual([]);
  expect(splitReceipt([{ ...items[0], cost: 0 }], { 8: 'alex' }).user_receipt_items).toEqual([]);
  expect(() => splitReceipt(items, { 8: 'alex' })).toThrow('Every item must be assigned');
});

test.each([
  [100, 'JPY', '¥100'],
  [100, 'TWD', 'NT$100'],
  [100, 'HKD', 'HK$100'],
  [1.25, 'HKD', 'HK$1.25'],
  [100, null, '100'],
  [0.1 + 0.2 + 0.7, 'TWD', 'NT$1'],
])('formats %s in %s', (amount, currency, expected) => {
  expect(formatMoney(amount, currency)).toBe(expected);
});

test('currency prefix follows the selected group', () => {
  expect(currencySymbol('HKD')).toBe('HK$');
  expect(currencySymbol(null)).toBeNull();
});

const receipt = {
  receipt_items: items,
  en_shop_name: 'Shop',
  jp_shop_name: '店',
  tax_percentage: 8,
  total_amount: 432,
  receipt_date: '2026-11-16T00:00:00Z',
};

test('parses receipt data at the route boundary', () => {
  const parsed = parseReceipt(JSON.stringify(receipt));
  expect(parsed?.receipt_date).toEqual(new Date('2026-11-16T00:00:00Z'));
  expect(parsed?.receipt_items).toEqual(items);
});

test.each([
  undefined,
  ['{}'],
  'invalid',
  'null',
  '{}',
  JSON.stringify({ ...receipt, receipt_date: 'bad' }),
  JSON.stringify({ ...receipt, receipt_items: [{ cost: '240' }] }),
])('rejects invalid receipt data %s', (value) => {
  expect(parseReceipt(value)).toBeNull();
});

test('a selected equal split uses group order to break ties and leaves legacy shared lines intact', () => {
  expect(
    splitReceipt(
      items,
      {
        8: 'alex',
        2: {
          mode: 'equal',
          portions: [
            { memberId: 'ren', units: 1 },
            { memberId: 'aya', units: 1 },
            { memberId: 'alex', units: 1 },
          ],
        },
        20: 'shared',
      },
      'JPY',
    ),
  ).toEqual({
    user_receipt_items: [
      { member_id: 'alex', cost: 273 },
      { member_id: 'ren', cost: 34 },
      { member_id: 'aya', cost: 33 },
    ],
    split_receipt_items: [60],
  });
});

test('a quantity split allocates an edited line cost by units, including discounted prices', () => {
  const item = { ...items[0], cost: 10, discount: 2, quantity: 3 };
  expect(
    splitReceipt(
      [item],
      {
        8: {
          mode: 'quantity',
          portions: [
            { memberId: 'aya', units: 1 },
            { memberId: 'ren', units: 2 },
          ],
        },
      },
      'USD',
    ).user_receipt_items,
  ).toEqual([
    { member_id: 'aya', cost: 3.33 },
    { member_id: 'ren', cost: 6.67 },
  ]);
});

test.each([
  ['10,50', 10.5],
  ['10.50', 10.5],
  [',75', 0.75],
  ['0.', 0],
  ['', 0],
  ['-5', NaN],
  ['10.5abc', NaN],
  ['1,50.00', NaN],
])('reads the entire decimal amount %j', (text, amount) => {
  expect(parseReceiptAmount(text)).toBe(amount);
});

test('legacy decimal deductions keep ordered scope and canonical totals take precedence', () => {
  const receipt_adjustments = [
    { kind: 'discount', amount: 0.1 },
    { kind: 'points_redemption', amount: 0.4, item_orders: [2] },
    { kind: 'discount', amount: 0.2, item_orders: [8, 2] },
  ];
  expect(readReceipt({ ...receipt, receipt_adjustments })).toMatchObject({
    receipt_discount: 0.3,
    points_redeemed: 0.4,
    split_rules: {
      discounts: [
        { amount: 0.1, item_orders: [] },
        { amount: 0.2, item_orders: [8, 2] },
      ],
      points: [{ amount: 0.4, item_orders: [2] }],
    },
  });
  expect(readReceipt({ ...receipt, receipt_adjustments, points_redeemed: 3 })).toMatchObject({
    receipt_discount: 0,
    points_redeemed: 3,
    split_rules: { discounts: [], points: [{ amount: 3, scope: 'basket', item_orders: [] }] },
  });
  expect(readReceipt({ ...receipt, receipt_discount: 0.3 })).toMatchObject({ points_redeemed: 0 });
  expect(readReceipt({ ...receipt, receipt_discount: -1 })).toBeNull();
});
