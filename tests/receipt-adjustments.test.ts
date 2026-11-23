import { adjustmentScope, signedAmount } from '@/components/receipt-adjustments';
import {
  allocationRequest,
  allocationSchema,
  applyAllocation,
  needsReview,
  printedPrice,
  readReceipt,
  type ReceiptData,
} from '@/utils/receipt';
import { scanReconciledReceipt } from '@/utils/receipt-preview';
import {
  finalCosts,
  listPrices,
  reconciledAllocation,
  reconciledScan,
  reviewScan,
} from './support/sugi-receipt';

const parse = (value: unknown): ReceiptData => {
  const receipt = readReceipt(value);
  if (!receipt) throw new Error('receipt did not parse');
  return receipt;
};

test('responses from older and newer backends both parse', () => {
  const { adjustments, tax_lines, reconciliation, decimal_places, ...legacy } = reconciledScan;
  const old = parse({
    ...legacy,
    receipt_items: legacy.receipt_items.map(({ list_price, ...item }) => item),
  });
  expect(old.adjustments).toBeUndefined();
  expect(old.reconciliation).toBeUndefined();
  expect(printedPrice(old.receipt_items[2])).toBe(1809);
  expect(needsReview(old)).toBe(false);

  const current = parse({ ...reconciledScan, future_field: true });
  expect(current.adjustments).toHaveLength(adjustments.length);
  expect(current.tax_lines).toEqual(tax_lines);
  expect(current.reconciliation).toEqual(reconciliation);
  expect(current.decimal_places).toBe(decimal_places);
  expect(printedPrice(current.receipt_items[2])).toBe(2310);
  expect(needsReview(current)).toBe(false);
  expect(needsReview(parse(reviewScan))).toBe(true);
});

test('a recalculation replaces every line’s cost, discount and the deductions', () => {
  const review = parse(reviewScan);
  const applied = applyAllocation(review, allocationSchema.parse(reconciledAllocation));

  expect(applied.receipt_items.map(({ cost }) => cost)).toEqual(finalCosts);
  expect(applied.receipt_items.map(({ discount }) => discount)).toEqual(
    listPrices.map((price, index) => price - finalCosts[index]),
  );
  expect(applied.receipt_items.map(({ english_name }) => english_name)).toEqual(
    review.receipt_items.map(({ english_name }) => english_name),
  );
  expect(applied.adjustments?.map(({ status }) => status)).toEqual([
    'verified',
    'verified',
    'verified',
    'verified',
  ]);
  expect(needsReview(applied)).toBe(false);
  // An item the recalculation does not mention is left as it was.
  const partial = allocationSchema.parse({
    ...reconciledAllocation,
    receipt_items: reconciledAllocation.receipt_items.slice(1),
  });
  expect(applyAllocation(review, partial).receipt_items[0]).toEqual(review.receipt_items[0]);
});

test('the correction request carries the receipt as printed and the chosen items', () => {
  const review = parse(reviewScan);
  const chosen = (review.adjustments ?? []).map((entry, index) =>
    index === 1 ? { ...entry, item_orders: [4], status: 'verified' as const } : entry,
  );

  const body = allocationRequest(review, chosen);

  expect(body.decimal_places).toBe(0);
  expect(body.total_amount).toBe(5809);
  expect(body.receipt_items).toEqual(
    listPrices.map((list_price, index) => ({ item_order: index + 1, list_price })),
  );
  expect(body.adjustments[1]).toEqual({
    printed_label: '1品割引',
    kind: 'discount',
    amount: 294,
    percentage: 15,
    eligible_subtotal: null,
    item_orders: [4],
  });
  expect(body.tax_lines).toEqual(reviewScan.tax_lines);

  const legacy = parse({ ...reconciledScan, tax_lines: undefined, decimal_places: undefined });
  expect(allocationRequest(legacy, []).tax_lines).toEqual([]);
  expect(allocationRequest(legacy, []).decimal_places).toBe(0);
});

test('a backend that reconciles receipts is not asked to read the photo again', async () => {
  const read = jest.fn().mockResolvedValue(reviewScan);
  const onRetry = jest.fn();

  const receipt = await scanReconciledReceipt(read, onRetry);

  expect(receipt?.reconciliation?.status).toBe('needs_review');
  expect(read).toHaveBeenCalledTimes(1);
  expect(onRetry).not.toHaveBeenCalled();

  // An older backend whose items do not add up is still read twice, then rejected.
  const { reconciliation, ...unreconciled } = reviewScan;
  const legacyRead = jest.fn().mockResolvedValue(unreconciled);
  expect(await scanReconciledReceipt(legacyRead, onRetry)).toBeNull();
  expect(legacyRead).toHaveBeenCalledTimes(2);
  expect(reconciliation.status).toBe('needs_review');
});

test('deductions describe their items and sign in a few words', () => {
  const receipt = parse(reconciledScan);
  const [itemDiscount, , subset, points] = receipt.adjustments ?? [];

  expect(adjustmentScope(itemDiscount, receipt.receipt_items)).toBe('Amino Moist');
  expect(adjustmentScope(subset, receipt.receipt_items)).toBe('Dry shampoo, Nose strips +2 more');
  expect(adjustmentScope(points, receipt.receipt_items)).toBe('Whole receipt');
  expect(adjustmentScope({ ...subset, item_orders: [1, 2] }, receipt.receipt_items)).toBe(
    'Dry shampoo, Nose strips',
  );
  expect(adjustmentScope({ ...itemDiscount, status: 'unresolved' }, receipt.receipt_items)).toBe(
    '15% printed',
  );
  expect(adjustmentScope({ ...points, status: 'unresolved' }, receipt.receipt_items)).toBe(
    'Not placed yet',
  );
  expect(adjustmentScope({ ...itemDiscount, item_orders: [] }, receipt.receipt_items)).toBe(
    'No items chosen',
  );
  expect(signedAmount(points, 'JPY')).toBe('−¥494');
  expect(signedAmount({ ...points, kind: 'surcharge', amount: 20 }, 'JPY')).toBe('+¥20');
});
