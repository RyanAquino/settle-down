import { z } from 'zod';

const receiptItemSchema = z.object({
  english_name: z.string(),
  japanese_name: z.string(),
  item_order: z.number().int(),
  // What the line cost after every discount, coupon and points; 0 while the
  // receipt does not reconcile (see `reconciliation`).
  cost: z.number().finite(),
  quantity: z.number().finite(),
  discount: z.number().finite().default(0),
  // The price printed on the item's own line. Absent from older backends.
  list_price: z.number().finite().optional(),
});
// A printed line that changed the amount to pay: a discount, coupon, points
// used, or a surcharge. The backend decides which items it covers.
export const adjustmentSchema = z.object({
  printed_label: z.string(),
  kind: z.enum(['discount', 'points', 'surcharge']),
  amount: z.number().finite(),
  percentage: z.number().finite().nullable().default(null),
  eligible_subtotal: z.number().finite().nullable().default(null),
  item_orders: z.array(z.number().int()),
  // verified: printed numbers prove its items; assumed: taken from the layout
  // or the whole receipt; unresolved: a person must choose its items.
  status: z.enum(['verified', 'assumed', 'unresolved']),
  allocations: z
    .array(z.object({ item_order: z.number().int(), amount: z.number().finite() }))
    .default([]),
});
export type ReceiptAdjustment = z.output<typeof adjustmentSchema>;
export type AdjustmentKind = ReceiptAdjustment['kind'];
const taxLineSchema = z.object({
  rate: z.number().finite().nullable(),
  taxable_amount: z.number().finite().nullable(),
  tax_amount: z.number().finite().nullable(),
});
const reconciliationSchema = z.object({
  status: z.enum(['reconciled', 'needs_review', 'mismatch']),
  difference: z.number().finite(),
});
export type ReceiptReconciliation = z.output<typeof reconciliationSchema>;
export const receiptSchema = z.object({
  receipt_items: z.array(receiptItemSchema),
  en_shop_name: z.string(),
  jp_shop_name: z.string(),
  tax_percentage: z.number().finite(),
  total_amount: z.number().finite(),
  receipt_date: z
    .union([z.string(), z.date()])
    .transform((v) => new Date(v))
    .refine((v) => !Number.isNaN(v.getTime())),
  receipt_image_url: z.string().optional(),
  // Present only from backends that reconcile receipts themselves.
  decimal_places: z.number().int().optional(),
  adjustments: z.array(adjustmentSchema).optional(),
  tax_lines: z.array(taxLineSchema).optional(),
  reconciliation: reconciliationSchema.optional(),
});
export type ReceiptData = z.output<typeof receiptSchema>;
// What `POST /api/v1/receipts/allocations/` returns for a corrected receipt.
export const allocationSchema = z.object({
  receipt_items: z.array(
    z.object({
      item_order: z.number().int(),
      list_price: z.number().finite(),
      cost: z.number().finite(),
      discount: z.number().finite(),
    }),
  ),
  adjustments: z.array(adjustmentSchema),
  reconciliation: reconciliationSchema,
  tax_percentage: z.number().finite(),
  total_amount: z.number().finite(),
});
export type ReceiptAllocation = z.output<typeof allocationSchema>;
export const groupSchema = z.object({
  name: z.string(),
  id: z.string(),
  currency: z.string().nullable(),
});
export const groupsSchema = z.object({ items: z.array(groupSchema).default([]) });
export type SettleUpGroup = z.output<typeof groupsSchema>['items'][number];
export const groupUserSchema = z.object({ name: z.string(), id: z.string() });
export const usersSchema = z.object({ items: z.array(groupUserSchema).default([]) });
export type GroupUser = z.output<typeof usersSchema>['items'][number];
export type ReceiptItem = ReceiptData['receipt_items'][number];

export function readReceipt(value: unknown): ReceiptData | null {
  const result = receiptSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseReceipt(value: string | string[] | undefined): ReceiptData | null {
  if (typeof value !== 'string') return null;
  try {
    return readReceipt(JSON.parse(value));
  } catch {
    return null;
  }
}

// A receipt field is an ungrouped decimal. Preserve the zero placeholder for an
// empty field and reject partially parsed pasted values.
export function parseReceiptAmount(text: string) {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return 0;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
  return Number(normalized);
}

export function receiptTotals(items: ReceiptItem[], taxPercentage: number) {
  // API costs are line totals and already include quantity.
  const subtotal = items.reduce((sum, item) => sum + item.cost, 0);
  return { subtotal, taxAmount: (subtotal * taxPercentage) / 100 };
}

const itemSplitSchema = z.object({
  mode: z.enum(['equal', 'quantity']),
  portions: z.array(z.object({ memberId: z.string(), units: z.number().positive() })),
});
export type ItemSplit = z.output<typeof itemSplitSchema>;

export const itemAssignmentSchema = z.union([z.string(), itemSplitSchema]);
export type ItemAssignment = z.output<typeof itemAssignmentSchema>;

export function moneyDigits(currency: string | null) {
  if (!currency) return 2;
  return (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function allocateMoney(amount: number, weights: number[], currency: string | null) {
  const scale = 10 ** moneyDigits(currency);
  const magnitude = Math.round(Math.abs(amount) * scale);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight, index) => {
    const portion = (magnitude * weight) / weightTotal;
    const units = Math.floor(portion);
    return { index, units, remainder: portion - units };
  });
  const leftover = magnitude - shares.reduce((sum, share) => sum + share.units, 0);
  // The input order breaks ties, which is the Settle Up roster order for a line.
  const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  ranked.slice(0, leftover).forEach((share) => share.units++);
  return shares.map(({ units }) => (Math.sign(amount) * units) / scale);
}

type ItemPortion = { memberId: string; cost: number; units?: number };

export function itemPortions(
  item: ReceiptItem,
  assignment: ItemAssignment,
  currency: string | null,
  users: GroupUser[] = [],
): ItemPortion[] {
  if (assignment === 'shared') {
    return users.map(({ id }) => ({ memberId: id, cost: item.cost / users.length }));
  }
  if (typeof assignment === 'string') return [{ memberId: assignment, cost: item.cost }];

  const weights = assignment.portions.map(({ units }) => units);
  const costs = allocateMoney(item.cost, weights, currency);
  return assignment.portions.map(({ memberId, units }, index) => ({
    memberId,
    cost: costs[index],
    units: assignment.mode === 'quantity' ? units : undefined,
  }));
}

export function splitReceipt(
  items: ReceiptItem[],
  selections: Record<number, ItemAssignment>,
  currency: string | null = null,
) {
  const userTotals = new Map<string, number>();
  const splitReceiptItems: number[] = [];
  for (const item of items) {
    const assignment = selections[item.item_order];
    if (!assignment) throw new Error('Every item must be assigned');
    if (assignment === 'shared') {
      splitReceiptItems.push(item.cost);
      continue;
    }
    for (const { memberId, cost } of itemPortions(item, assignment, currency)) {
      userTotals.set(memberId, (userTotals.get(memberId) ?? 0) + cost);
    }
  }
  return {
    user_receipt_items: [...userTotals]
      .filter(([, cost]) => cost > 0)
      .map(([member_id, cost]) => ({ member_id, cost })),
    split_receipt_items: splitReceiptItems,
  };
}

// Formats an amount in the selected group's currency. `symbol` display keeps
// NT$/HK$/CN¥ distinct from $/¥. Whole amounts drop their `.00` (TWD receipts
// are whole even though ISO gives it 2 decimals); other amounts use the
// currency's own decimals. With no currency it's a plain number.
export const formatMoney = (n: number, currency: string | null) => {
  if (!Number.isFinite(n)) return '—';
  const base: Intl.NumberFormatOptions = currency
    ? { style: 'currency', currency }
    : { maximumFractionDigits: 2 };
  const digits = moneyDigits(currency);
  // Round first so float noise (0.1 + 0.2 + 0.7) still counts as whole.
  const rounded = Number(n.toFixed(digits));
  return new Intl.NumberFormat('en-US', {
    ...base,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : digits,
  }).format(rounded);
};

// The bare symbol (¥, NT$, SGD) for the per-item price input prefix. Strips the
// digits from a formatted 0 rather than using formatToParts, which Hermes may lack.
export const currencySymbol = (currency: string | null) =>
  currency ? formatMoney(0, currency).replace(/[\d\s.,]/g, '') : null;

// The printed price of a line: `list_price` from backends that report it,
// otherwise the cost, which older backends set to the printed price less its
// own discount.
export const printedPrice = (item: ReceiptItem) => item.list_price ?? item.cost;

// Whether a receipt still needs a person before it can be split: the backend
// could not reconcile it, or deductions were edited and not recalculated yet.
export const needsReview = (receipt: ReceiptData) =>
  receipt.reconciliation !== undefined && receipt.reconciliation.status !== 'reconciled';

// The receipt with a recalculation applied: each line's cost and discount, the
// deductions as allocated, and the reconciliation that goes with them.
export function applyAllocation(receipt: ReceiptData, allocation: ReceiptAllocation): ReceiptData {
  const byOrder = new Map(allocation.receipt_items.map((item) => [item.item_order, item]));
  return {
    ...receipt,
    receipt_items: receipt.receipt_items.map((item) => {
      const allocated = byOrder.get(item.item_order);
      return allocated
        ? {
            ...item,
            cost: allocated.cost,
            discount: allocated.discount,
            list_price: allocated.list_price,
          }
        : item;
    }),
    adjustments: allocation.adjustments,
    reconciliation: allocation.reconciliation,
    tax_percentage: allocation.tax_percentage,
    total_amount: allocation.total_amount,
  };
}

// The body `POST /api/v1/receipts/allocations/` expects: the receipt as printed,
// with each deduction applied to the items a person chose.
export function allocationRequest(receipt: ReceiptData, adjustments: ReceiptAdjustment[]) {
  return {
    decimal_places: receipt.decimal_places ?? 0,
    receipt_items: receipt.receipt_items.map((item) => ({
      item_order: item.item_order,
      list_price: printedPrice(item),
    })),
    adjustments: adjustments.map((adjustment) => ({
      printed_label: adjustment.printed_label,
      kind: adjustment.kind,
      amount: adjustment.amount,
      percentage: adjustment.percentage,
      eligible_subtotal: adjustment.eligible_subtotal,
      item_orders: adjustment.item_orders,
    })),
    tax_lines: receipt.tax_lines ?? [],
    total_amount: receipt.total_amount,
  };
}
