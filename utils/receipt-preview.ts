import {
  allocateMoney,
  deductionScope,
  deductionTotal,
  itemPortions,
  moneyDigits,
  readReceipt,
  receiptTotals,
  receiptFractionDigits,
  type GroupUser,
  type ItemAssignment,
  type ReceiptItem,
  type ReceiptData,
  type SplitDeduction,
  type DeductionStage,
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
  discounts: SplitDeduction[],
  points: SplitDeduction[],
  taxAmount: number,
  digits: number,
): ReceiptItem[] | null {
  const paid = items.map((item) => ({ ...item })).sort((a, b) => a.item_order - b.item_order);
  const distribute = (amount: number, lines: ReceiptItem[]) => {
    const scale = 10 ** digits;
    const weights = lines.map((item) => Math.round(item.cost * scale));
    const available = weights.reduce((sum, units) => sum + units, 0) / scale;
    if (available + amount < -1e-7 || (available === 0 && amount !== 0)) return false;
    const shares = allocateMoney(amount, weights, digits);
    lines.forEach((line, i) => {
      line.cost = Number((line.cost + shares[i]).toFixed(digits));
    });
    return true;
  };
  // Apply basket coupons to eligible purchases, add any excluded tax, then spend
  // points on the remaining bill. Each deduction is allocated once in receipt units.
  const deduct = (rule: SplitDeduction, stage: DeductionStage) => {
    const scope = deductionScope(rule, stage);
    if (scope === 'basket') return !rule.item_orders.length && distribute(-rule.amount, paid);
    if (scope !== 'items' || !rule.item_orders.length) return false;
    const eligible = new Set(rule.item_orders);
    if (eligible.size !== rule.item_orders.length) return false;
    const lines = paid.filter((item) => eligible.has(item.item_order));
    return lines.length === eligible.size && distribute(-rule.amount, lines);
  };
  if (
    !discounts.every((rule) => deduct(rule, 'discounts')) ||
    !distribute(taxAmount, paid) ||
    !points.every((rule) => deduct(rule, 'points'))
  )
    return null;
  return paid;
}

type ReceiptAmounts = Pick<
  ReceiptData,
  | 'receipt_items'
  | 'tax_percentage'
  | 'total_amount'
  | 'receipt_discount'
  | 'points_redeemed'
  | 'split_rules'
>;

// Choose the printed tax treatment that most closely explains the payment.
// A remaining difference is shown for review and always blocks the split.
export function receiptPayment(receipt: ReceiptAmounts) {
  const { receipt_items, receipt_discount, points_redeemed, total_amount, tax_percentage } =
    receipt;
  const { subtotal } = receiptTotals(receipt_items, tax_percentage);
  const afterCoupons = subtotal - receipt_discount;
  const net = afterCoupons - points_redeemed;
  const digits = receiptFractionDigits([
    total_amount,
    receipt_discount,
    points_redeemed,
    ...receipt_items.map((item) => item.cost),
    ...receipt.split_rules.discounts.map((rule) => rule.amount),
    ...receipt.split_rules.points.map((rule) => rule.amount),
  ]);
  const printedDigits = digits === 0 ? 0 : Math.max(2, digits);
  const scale = 10 ** printedDigits;
  const tax = ((afterCoupons * tax_percentage) / 100) * scale;
  const candidates = [0, Math.floor(tax + 1e-7) / scale, Math.ceil(tax - 1e-7) / scale];
  const taxAmount = candidates.reduce((best, value) =>
    Math.abs(total_amount - net - value) < Math.abs(total_amount - net - best) ? value : best,
  );
  const shoppingTotal = Number((afterCoupons + taxAmount).toFixed(printedDigits));
  const difference = Number(
    (total_amount - (shoppingTotal - points_redeemed)).toFixed(printedDigits),
  );
  return { subtotal, taxAmount, shoppingTotal, difference, printedDigits };
}

export function pricesBeforeDeduction(
  receipt: ReceiptAmounts,
  stage: DeductionStage,
  index: number,
  currency: string | null,
) {
  const { printedDigits, taxAmount } = receiptPayment(receipt);
  const rules = receipt.split_rules;
  return adjustedLinePrices(
    receipt.receipt_items,
    stage === 'discounts' ? rules.discounts.slice(0, index) : rules.discounts,
    stage === 'points' ? rules.points.slice(0, index) : [],
    stage === 'points' ? taxAmount : 0,
    currency ? moneyDigits(currency) : printedDigits,
  );
}

function readable(receipt: ReceiptAmounts) {
  const items = receipt.receipt_items;
  return (
    receipt.total_amount >= 0 &&
    receipt.tax_percentage >= 0 &&
    items.length > 0 &&
    items.every((item) => Number.isFinite(item.cost) && item.cost >= 0) &&
    new Set(items.map((item) => item.item_order)).size === items.length
  );
}

export function reconcileReceipt(
  receipt: ReceiptAmounts,
  currency?: string | null,
): ReceiptBalance | null {
  if (!readable(receipt)) return null;
  const { subtotal, taxAmount, difference, printedDigits } = receiptPayment(receipt);
  if (difference !== 0) return null;
  const {
    receipt_items: items,
    total_amount: total,
    receipt_discount,
    points_redeemed,
    split_rules,
  } = receipt;
  if (total === 0 && !receipt_discount && !points_redeemed && !items.some((i) => i.discount > 0))
    return null;
  if (
    deductionTotal(split_rules.discounts) !== receipt_discount ||
    deductionTotal(split_rules.points) !== points_redeemed
  )
    return null;
  const digits = currency ? moneyDigits(currency) : printedDigits;
  if (Number(total.toFixed(digits)) !== total) return null;
  if (!receipt_discount && !points_redeemed) return { subtotal, taxAmount, total };
  const adjustedItems = adjustedLinePrices(
    items,
    split_rules.discounts,
    split_rules.points,
    taxAmount,
    digits,
  );
  if (
    !adjustedItems ||
    Math.abs(adjustedItems.reduce((sum, line) => sum + line.cost, 0) - total) > 1e-7
  )
    return null;
  return { subtotal, taxAmount, total, adjustedItems };
}

export async function scanReconciledReceipt(read: () => Promise<unknown>, onRetry: () => void) {
  let lastReadable: ReceiptData | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) onRetry();
    let receipt: ReceiptData | null;
    try {
      receipt = readReceipt(await read());
    } catch (error) {
      if (lastReadable) return lastReadable;
      throw error;
    }
    if (receipt && readable(receipt)) {
      lastReadable = receipt;
      if (receiptPayment(receipt).difference === 0) break;
    }
  }
  return lastReadable;
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
