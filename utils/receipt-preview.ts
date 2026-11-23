import {
  allocateMoney,
  itemPortions,
  moneyDigits,
  readReceipt,
  receiptTotals,
  type GroupUser,
  type ItemAssignment,
  type ReceiptItem,
  type ReceiptAdjustment,
} from './receipt';

type ReceiptBalance = {
  subtotal: number;
  taxAmount: number;
  total: number;
  // Paid line totals, including allocated tax and receipt-wide deductions.
  adjustedItems?: ReceiptItem[];
};

function adjustedLinePrices(
  items: ReceiptItem[],
  adjustments: ReceiptAdjustment[],
  taxAmount: number,
  digits: number,
): ReceiptItem[] | null {
  const paid = items.map((item) => ({ ...item })).sort((a, b) => a.item_order - b.item_order);
  const distribute = (amount: number, lines: ReceiptItem[]) => {
    const weights = lines.map((item) => item.cost);
    const available = weights.reduce((sum, cost) => sum + cost, 0);
    if (available + amount < -1e-7 || (available === 0 && amount !== 0)) return false;
    const shares = allocateMoney(amount, weights, digits);
    lines.forEach((line, i) => {
      line.cost = Number((line.cost + shares[i]).toFixed(digits));
    });
    return true;
  };
  // Apply basket coupons to eligible purchases, add any excluded tax, then spend
  // points on the remaining bill. Each deduction is allocated once in receipt units.
  const deduct = ({ amount, item_orders }: ReceiptAdjustment) => {
    if (!item_orders.length) return distribute(-amount, paid);
    const eligible = new Set(item_orders);
    if (eligible.size !== item_orders.length) return false;
    const lines = paid.filter((item) => eligible.has(item.item_order));
    return lines.length === eligible.size && distribute(-amount, lines);
  };
  const discounts = adjustments.filter(({ kind }) => kind === 'discount');
  const points = adjustments.filter(({ kind }) => kind === 'points_redemption');
  if (!discounts.every(deduct) || !distribute(taxAmount, paid) || !points.every(deduct))
    return null;
  return paid;
}

export function reconcileReceipt(
  items: ReceiptItem[],
  taxPercentage: number,
  total: number,
  adjustments: ReceiptAdjustment[] = [],
): ReceiptBalance | null {
  const { subtotal } = receiptTotals(items, taxPercentage);
  if (
    !Number.isFinite(subtotal) ||
    !Number.isFinite(taxPercentage) ||
    subtotal <= 0 ||
    !Number.isFinite(total) ||
    total < 0 ||
    (total === 0 && !adjustments.length) ||
    taxPercentage < 0 ||
    items.some(({ cost }) => cost < 0) ||
    new Set(items.map(({ item_order }) => item_order)).size !== items.length
  ) {
    return null;
  }

  const basketDiscount = adjustments.reduce(
    (sum, a) => sum + (a.kind === 'discount' ? a.amount : 0),
    0,
  );
  const afterCoupons = subtotal - basketDiscount;
  const net = adjustments.reduce((sum, a) => sum - a.amount, subtotal);
  const matchesTotal = (amount: number) => Math.abs(total - amount) < 1e-7;
  if (!adjustments.length && matchesTotal(subtotal))
    return { subtotal: total, taxAmount: 0, total };

  // OCR amounts have no currency code. Whole numbers use whole receipt units.
  const amounts = [
    total,
    ...items.map(({ cost }) => cost),
    ...adjustments.map(({ amount }) => amount),
  ];
  const visibleDigits = amounts.reduce((digits, amount) => {
    const fraction = amount.toString().split('.')[1];
    return Math.max(digits, fraction?.length ?? 0);
  }, 0);
  const printedDigits = visibleDigits === 0 ? 0 : Math.max(2, visibleDigits);
  const scale = 10 ** printedDigits;
  let taxAmount = 0;
  if (!matchesTotal(net)) {
    const scaledTax = ((afterCoupons * taxPercentage) / 100) * scale;
    const lower = Math.floor(scaledTax + 1e-7) / scale;
    const upper = Math.ceil(scaledTax - 1e-7) / scale;
    if (!matchesTotal(net + lower) && !matchesTotal(net + upper)) return null;
    taxAmount = Number((total - net).toFixed(printedDigits));
  }

  if (!adjustments.length) return { subtotal, taxAmount, total };
  const adjustedItems = adjustedLinePrices(items, adjustments, taxAmount, printedDigits);
  return adjustedItems && { subtotal, taxAmount, total, adjustedItems };
}

export async function scanReconciledReceipt(read: () => Promise<unknown>, onRetry: () => void) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) onRetry();
    const receipt = readReceipt(await read());
    if (
      receipt &&
      reconcileReceipt(
        receipt.receipt_items,
        receipt.tax_percentage,
        receipt.total_amount,
        receipt.receipt_adjustments,
      )
    ) {
      return receipt;
    }
  }
  return null;
}

type PreviewLine = { id: number; name: string; portion?: string; amount: number };

export function previewReceipt(
  items: ReceiptItem[],
  assignments: Record<number, ItemAssignment>,
  users: GroupUser[],
  currency: string | null,
  balance: ReceiptBalance,
) {
  const lines = new Map<string, PreviewLine[]>();
  const digits = moneyDigits(currency);
  const round = (amount: number) => Number(amount.toFixed(digits));

  for (const item of balance.adjustedItems ?? items) {
    const assignment = assignments[item.item_order];
    const portions = itemPortions(item, assignment, currency, users);
    for (const { memberId, cost, units } of portions) {
      const portion = units
        ? `×${units}`
        : portions.length > 1
          ? `1 of ${portions.length} shares`
          : undefined;
      const line = {
        id: item.item_order,
        name: item.english_name || item.japanese_name,
        portion,
        amount: cost,
      };
      const memberLines = lines.get(memberId);
      if (memberLines) memberLines.push(line);
      else lines.set(memberId, [line]);
    }
  }

  const participants = users.flatMap((user) => {
    const memberLines = lines.get(user.id);
    return memberLines ? [{ user, lines: memberLines }] : [];
  });
  const weights = participants.map(({ lines }) =>
    lines.reduce((sum, line) => sum + line.amount, 0),
  );
  // Group-wide shared items retain their full-precision proportions. Round the
  // estimate against the scanned total, as Settle Up receives that total and weights.
  const totals = allocateMoney(balance.total, weights, digits);
  const taxes = allocateMoney(balance.adjustedItems ? 0 : balance.taxAmount, totals, digits);

  return participants.map(({ user, lines }, index) => {
    const amounts = lines.map((line) => ({ ...line, amount: round(line.amount) }));
    const shownSubtotal = amounts.reduce((sum, line) => sum + line.amount, 0);
    return {
      user,
      lines: amounts,
      total: totals[index],
      taxAmount: taxes[index],
      rounding: round(totals[index] - taxes[index] - shownSubtotal),
    };
  });
}
