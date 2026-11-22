import {
  allocateMoney,
  itemPortions,
  moneyDigits,
  readReceipt,
  receiptTotals,
  type GroupUser,
  type ItemAssignment,
  type ReceiptItem,
} from './receipt';

type ReceiptBalance = { subtotal: number; taxAmount: number; total: number };

export function reconcileReceipt(
  items: ReceiptItem[],
  taxPercentage: number,
  total: number,
): ReceiptBalance | null {
  const { subtotal, taxAmount } = receiptTotals(items, taxPercentage);
  if (
    !Number.isFinite(subtotal) ||
    !Number.isFinite(taxPercentage) ||
    subtotal <= 0 ||
    total <= 0 ||
    taxPercentage < 0 ||
    items.some(({ cost }) => cost < 0) ||
    new Set(items.map(({ item_order }) => item_order)).size !== items.length
  ) {
    return null;
  }

  const matchesTotal = (amount: number) => Math.abs(total - amount) < 1e-7;
  if (matchesTotal(subtotal)) return { subtotal: total, taxAmount: 0, total };

  // OCR returns numeric amounts without a currency. Use the visible amount precision
  // to recognize tax rounded up or down on the receipt, including whole yen.
  const visibleDigits = [total, ...items.map(({ cost }) => cost)].reduce((digits, amount) => {
    const fraction = amount.toString().split('.')[1];
    return Math.max(digits, fraction?.length ?? 0);
  }, 0);
  const printedDigits = visibleDigits === 0 ? 0 : Math.max(2, visibleDigits);
  const scale = 10 ** printedDigits;
  const scaledTax = taxAmount * scale;
  const lower = Math.floor(scaledTax + 1e-7) / scale;
  const upper = Math.ceil(scaledTax - 1e-7) / scale;

  if (!matchesTotal(subtotal + lower) && !matchesTotal(subtotal + upper)) return null;
  return { subtotal, taxAmount: Number((total - subtotal).toFixed(printedDigits)), total };
}

export async function scanReconciledReceipt(read: () => Promise<unknown>, onRetry: () => void) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) onRetry();
    const receipt = readReceipt(await read());
    if (
      receipt &&
      reconcileReceipt(receipt.receipt_items, receipt.tax_percentage, receipt.total_amount)
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

  for (const item of items) {
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
  const totals = allocateMoney(balance.total, weights, currency);
  const taxes = allocateMoney(balance.taxAmount, totals, currency);

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
