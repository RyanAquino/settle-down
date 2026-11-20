import { z } from 'zod';

const receiptItemSchema = z.object({
  english_name: z.string(),
  japanese_name: z.string(),
  item_order: z.number().int(),
  cost: z.number().finite(),
  quantity: z.number().finite(),
  discount: z.number().finite(),
});
const receiptSchema = z.object({
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
});
export type ReceiptData = z.output<typeof receiptSchema>;
export const groupsSchema = z.object({
  items: z
    .array(z.object({ name: z.string(), id: z.string(), currency: z.string().nullable() }))
    .default([]),
});
export type SettleUpGroup = z.output<typeof groupsSchema>['items'][number];
export const usersSchema = z.object({
  items: z.array(z.object({ name: z.string(), id: z.string() })).default([]),
});
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

export function receiptTotals(items: ReceiptItem[], taxPercentage: number) {
  // API costs are line totals and already include quantity.
  const subtotal = items.reduce((sum, item) => sum + item.cost, 0);
  return { subtotal, taxAmount: (subtotal * taxPercentage) / 100 };
}

export type ItemSplit = {
  mode: 'equal' | 'quantity';
  portions: { memberId: string; units: number }[];
};

export type ItemAssignment = string | ItemSplit;

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
