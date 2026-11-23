import { z } from 'zod';

const receiptItemSchema = z.object({
  english_name: z.string(),
  japanese_name: z.string(),
  item_order: z.number().int(),
  cost: z.number().finite(),
  quantity: z.number().finite(),
  discount: z.number().finite().default(0),
});
const splitDeductionSchema = z.object({
  amount: z.number().positive(),
  item_orders: z.array(z.number().int()).default([]),
});
export type SplitDeduction = z.output<typeof splitDeductionSchema>;
const splitRulesSchema = z.object({
  discounts: z.array(splitDeductionSchema).default([]),
  points: z.array(splitDeductionSchema).default([]),
});

const legacyAdjustmentSchema = splitDeductionSchema.extend({
  kind: z.enum(['discount', 'points_redemption']),
});

export function receiptFractionDigits(amounts: number[]) {
  return amounts.reduce(
    (digits, amount) => Math.max(digits, amount.toString().split('.')[1]?.length ?? 0),
    0,
  );
}

function legacyDeductionTotal(entries: SplitDeduction[]) {
  // Round the sum back to the precision printed on these deductions.
  const amounts = entries.map(({ amount }) => amount);
  return Number(
    amounts.reduce((sum, amount) => sum + amount, 0).toFixed(receiptFractionDigits(amounts)),
  );
}

function legacySplitRules(entries: SplitDeduction[]) {
  if (entries.length === 1 && entries[0].item_orders.length === 0) return [];
  return entries.map(({ amount, item_orders }) => ({ amount, item_orders }));
}

export const receiptSchema = z
  .object({
    receipt_items: z.array(receiptItemSchema),
    receipt_discount: z.number().nonnegative().optional(),
    points_redeemed: z.number().nonnegative().optional(),
    split_rules: splitRulesSchema.optional(),
    receipt_adjustments: z.array(legacyAdjustmentSchema).optional(),
    en_shop_name: z.string(),
    jp_shop_name: z.string(),
    tax_percentage: z.number().finite(),
    total_amount: z.number().finite(),
    receipt_date: z
      .union([z.string(), z.date()])
      .transform((v) => new Date(v))
      .refine((v) => !Number.isNaN(v.getTime())),
    receipt_image_url: z.string().optional(),
  })
  .transform(
    ({ receipt_adjustments = [], receipt_discount, points_redeemed, split_rules, ...receipt }) => {
      // The same boundary reads scan responses, routes and previously saved inbox drafts.
      if (
        receipt_discount !== undefined ||
        points_redeemed !== undefined ||
        split_rules !== undefined
      ) {
        return {
          ...receipt,
          receipt_discount: receipt_discount ?? 0,
          points_redeemed: points_redeemed ?? 0,
          split_rules: split_rules ?? { discounts: [], points: [] },
        };
      }
      const discounts = receipt_adjustments.filter((entry) => entry.kind === 'discount');
      const points = receipt_adjustments.filter((entry) => entry.kind === 'points_redemption');
      return {
        ...receipt,
        receipt_discount: legacyDeductionTotal(discounts),
        points_redeemed: legacyDeductionTotal(points),
        split_rules: { discounts: legacySplitRules(discounts), points: legacySplitRules(points) },
      };
    },
  );
export type ReceiptData = z.output<typeof receiptSchema>;
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

export function allocateMoney(amount: number, weights: number[], digits: number) {
  const scale = 10 ** digits;
  const magnitude = Math.round(Math.abs(amount) * scale);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) return weights.map(() => 0);
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
  const costs = allocateMoney(item.cost, weights, moneyDigits(currency));
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
