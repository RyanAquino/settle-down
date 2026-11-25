// The Sugi Pharmacy receipt as the backend returns it: two item discounts, an 8%
// discount on the four items without one, and 494 of points. The final shares
// (837, 744, 1,809, 1,533, 650, 236) add up to the 5,809 paid.

const names = [
  ['Dry shampoo', 'ダイアンPドライシャンプ'],
  ['Nose strips', 'ナイトミン鼻呼吸テープ'],
  ['Amino Moist', 'ミノン アミノモイスト'],
  ['Neck warmer', 'あずきのチカラ 首肩用'],
  ['Soft masks', 'Wソフトマスク小60'],
  ['Chocolate bar', 'ミルクのサンダーミニバー'],
] as const;
export const listPrices = [987, 877, 2310, 1958, 767, 278];
export const finalCosts = [837, 744, 1809, 1533, 650, 236];
const allocations = [
  [{ item_order: 3, amount: 347 }],
  [{ item_order: 4, amount: 294 }],
  [
    { item_order: 1, amount: 79 },
    { item_order: 2, amount: 70 },
    { item_order: 5, amount: 62 },
    { item_order: 6, amount: 22 },
  ],
  [
    { item_order: 1, amount: 71 },
    { item_order: 2, amount: 63 },
    { item_order: 3, amount: 154 },
    { item_order: 4, amount: 131 },
    { item_order: 5, amount: 55 },
    { item_order: 6, amount: 20 },
  ],
];

const adjustment = (
  printed_label: string,
  kind: 'discount' | 'points',
  amount: number,
  percentage: number | null,
  eligible_subtotal: number | null,
  item_orders: number[],
  status: 'verified' | 'assumed' | 'unresolved',
  shares: { item_order: number; amount: number }[],
) => ({
  printed_label,
  kind,
  amount,
  percentage,
  eligible_subtotal,
  item_orders,
  status,
  allocations: shares,
});

const reconciledAdjustments = [
  adjustment('1品割引', 'discount', 347, 15, null, [3], 'verified', allocations[0]),
  adjustment('1品割引', 'discount', 294, 15, null, [4], 'verified', allocations[1]),
  adjustment('全品割引', 'discount', 233, 8, 2909, [1, 2, 5, 6], 'verified', allocations[2]),
  adjustment(
    'スギポイント値引金額',
    'points',
    494,
    null,
    null,
    [1, 2, 3, 4, 5, 6],
    'assumed',
    allocations[3],
  ),
];

const scan = (costs: number[], discounts: number[]) => ({
  receipt_items: names.map(([english_name, japanese_name], index) => ({
    english_name,
    japanese_name,
    item_order: index + 1,
    cost: costs[index],
    quantity: 1,
    discount: discounts[index],
    list_price: listPrices[index],
  })),
  en_shop_name: 'Sugi Pharmacy',
  jp_shop_name: 'スギ薬局',
  tax_percentage: 10,
  total_amount: 5809,
  receipt_date: '2026-11-23T15:16:00',
  receipt_image_url: 'https://example.com/sugi.jpg',
  decimal_places: 0,
  tax_lines: [
    { rate: 8, taxable_amount: 236, tax_amount: 17 },
    { rate: 10, taxable_amount: 5573, tax_amount: 506 },
  ],
});

const zeros = names.map(() => 0);

export const reconciledScan = {
  ...scan(
    finalCosts,
    listPrices.map((price, index) => price - finalCosts[index]),
  ),
  adjustments: reconciledAdjustments,
  reconciliation: { status: 'reconciled', difference: 0 },
};

// Both 15% lines were read under item 3: the second cannot be placed.
export const reviewScan = {
  ...scan(zeros, zeros),
  adjustments: [
    { ...reconciledAdjustments[0], allocations: [] },
    { ...reconciledAdjustments[1], item_orders: [3], status: 'unresolved', allocations: [] },
    { ...reconciledAdjustments[2], allocations: [] },
    { ...reconciledAdjustments[3], allocations: [] },
  ],
  reconciliation: { status: 'needs_review', difference: 0 },
};

// The points line was not read: the lines leave 494 unaccounted for.
export const mismatchScan = {
  ...scan(zeros, zeros),
  adjustments: reconciledAdjustments.slice(0, 3).map((entry) => ({ ...entry, allocations: [] })),
  reconciliation: { status: 'mismatch', difference: -494 },
};

// What POST /api/v1/receipts/allocations/ returns once every line is placed.
export const reconciledAllocation = {
  receipt_items: listPrices.map((list_price, index) => ({
    item_order: index + 1,
    list_price,
    cost: finalCosts[index],
    discount: list_price - finalCosts[index],
  })),
  adjustments: reconciledAdjustments.map((entry) => ({ ...entry, status: 'verified' })),
  reconciliation: { status: 'reconciled', difference: 0 },
  tax_percentage: 10,
  total_amount: 5809,
};
