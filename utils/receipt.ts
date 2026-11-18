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

export function parseReceipt(value: string | string[] | undefined): ReceiptData | null {
  if (typeof value !== 'string') return null;
  try {
    return receiptSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function receiptTotals(items: ReceiptItem[], taxPercentage: number) {
  // API costs are line totals and already include quantity.
  const subtotal = items.reduce((sum, item) => sum + item.cost, 0);
  return { subtotal, taxAmount: (subtotal * taxPercentage) / 100 };
}

export function splitReceipt(items: ReceiptItem[], selections: Record<number, string>) {
  const userTotals = new Map<string, number>();
  const splitReceiptItems: number[] = [];
  for (const item of items) {
    const member = selections[item.item_order];
    if (!member) throw new Error('Every item must be assigned');
    if (member === 'shared') splitReceiptItems.push(item.cost);
    else userTotals.set(member, (userTotals.get(member) ?? 0) + item.cost);
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
  const digits = new Intl.NumberFormat('en-US', base).resolvedOptions().maximumFractionDigits ?? 2;
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
