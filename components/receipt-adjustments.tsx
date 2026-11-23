import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/motion';
import {
  formatMoney,
  type ReceiptAdjustment,
  type ReceiptItem,
  type ReceiptReconciliation,
} from '@/utils/receipt';
import { shadow, theme, type } from '@/utils/theme';

export const KIND_LABELS = { discount: 'Discount', points: 'Points', surcharge: 'Charge' } as const;

// Which items a deduction covers, in a few words. A line still to be placed
// says what the receipt printed instead; its chip asks for the items.
export function adjustmentScope(adjustment: ReceiptAdjustment, items: ReceiptItem[]) {
  if (adjustment.status === 'unresolved') {
    return adjustment.percentage === null ? 'Not placed yet' : `${adjustment.percentage}% printed`;
  }
  const orders = new Set(adjustment.item_orders);
  const covered = items.filter((item) => orders.has(item.item_order));
  if (covered.length === 0) return 'No items chosen';
  if (items.length > 1 && covered.length === items.length) return 'Whole receipt';
  const names = covered.map((item) => item.english_name || item.japanese_name);
  return names.length <= 2
    ? names.join(', ')
    : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export const signedAmount = (adjustment: ReceiptAdjustment, currency: string | null) =>
  `${adjustment.kind === 'surcharge' ? '+' : '−'}${formatMoney(adjustment.amount, currency)}`;

export default function ReceiptAdjustments({
  adjustments,
  items,
  currency,
  reconciliation,
  pending,
  recalculating,
  error,
  onEdit,
  onAdd,
  onRetry,
}: {
  adjustments: ReceiptAdjustment[];
  items: ReceiptItem[];
  currency: string | null;
  reconciliation: ReceiptReconciliation | undefined;
  pending: boolean;
  recalculating: boolean;
  error: string | null;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onRetry: () => void;
}) {
  const unresolved = adjustments.filter(({ status }) => status === 'unresolved').length;
  let notice: string | null = null;
  if (recalculating) notice = 'Recalculating everyone’s share…';
  else if (unresolved > 0)
    notice =
      unresolved === 1
        ? 'Choose the items this line covers. The receipt doesn’t say.'
        : `Choose the items ${unresolved} lines cover. The receipt doesn’t say.`;
  else if (!pending && reconciliation?.status === 'mismatch')
    notice = `These lines leave ${formatMoney(Math.abs(reconciliation.difference), currency)} unaccounted for. Compare them with the photo, or add one that’s missing.`;

  return (
    <View style={styles.card} testID="receipt-adjustments">
      <View style={styles.header}>
        <Text style={styles.eyebrow}>DISCOUNTS & POINTS</Text>
        {recalculating && <ActivityIndicator size="small" color={theme.inkMuted} />}
      </View>
      {notice && (
        <Text
          style={[styles.notice, !recalculating && styles.noticeAction]}
          testID="receipt-adjustments-notice"
          accessibilityLiveRegion="polite"
        >
          {notice}
        </Text>
      )}
      {error && !recalculating && (
        <PressableScale style={styles.retry} haptic="light" onPress={onRetry} testID="recalculate">
          <Text style={styles.retryText}>{error} Try again</Text>
        </PressableScale>
      )}
      {adjustments.map((adjustment, index) => {
        const needsChoice = adjustment.status === 'unresolved';
        return (
          <PressableScale
            key={`${index}-${adjustment.printed_label}`}
            style={[styles.row, index > 0 && styles.rowDivider]}
            scaleTo={0.99}
            disabled={recalculating}
            onPress={() => onEdit(index)}
            testID={`adjustment-${index}`}
            accessibilityHint="Choose the items it covers or change the amount"
          >
            <View style={styles.rowText}>
              <View style={styles.titleRow}>
                <Text style={styles.label} numberOfLines={1}>
                  {adjustment.printed_label || KIND_LABELS[adjustment.kind]}
                </Text>
                {needsChoice ? (
                  <Text style={[styles.chip, styles.chipAction]}>Choose items</Text>
                ) : adjustment.status === 'assumed' ? (
                  <Text style={styles.chip}>Check items</Text>
                ) : null}
              </View>
              <Text style={styles.scope} numberOfLines={1}>
                {KIND_LABELS[adjustment.kind]} · {adjustmentScope(adjustment, items)}
              </Text>
            </View>
            <Text style={styles.amount}>{signedAmount(adjustment, currency)}</Text>
          </PressableScale>
        );
      })}
      <PressableScale
        style={[styles.add, adjustments.length > 0 && styles.rowDivider]}
        disabled={recalculating}
        onPress={onAdd}
        testID="add-adjustment"
      >
        <Text style={styles.addText}>Add a discount or points</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    ...shadow.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    minHeight: 32,
  },
  eyebrow: { fontSize: 10, fontWeight: '600', color: theme.inkFaint, letterSpacing: 0.6 },
  notice: { ...type.label, color: theme.inkMuted, paddingHorizontal: 14, paddingTop: 4 },
  noticeAction: { color: theme.warn },
  retry: {
    alignSelf: 'flex-start',
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.danger,
  },
  retryText: { fontSize: 12, color: theme.danger, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  rowText: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { ...type.body, fontSize: 15, color: theme.ink, flexShrink: 1 },
  chip: {
    ...type.label,
    fontSize: 11,
    color: theme.inkMuted,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipAction: { color: theme.accentInk, backgroundColor: theme.accentBg },
  scope: { fontSize: 13, color: theme.inkMuted },
  amount: { ...type.body, ...type.numeral, fontSize: 15, color: theme.ink },
  add: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14 },
  addText: { ...type.label, color: theme.accentInk },
});
