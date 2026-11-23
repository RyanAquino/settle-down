import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/motion';
import { KIND_LABELS } from '@/components/receipt-adjustments';
import {
  currencySymbol,
  formatMoney,
  parseReceiptAmount,
  printedPrice,
  type AdjustmentKind,
  type ReceiptAdjustment,
  type ReceiptItem,
} from '@/utils/receipt';
import { theme, type } from '@/utils/theme';

const KINDS: AdjustmentKind[] = ['discount', 'points', 'surcharge'];

export default function ReceiptAdjustmentEditor({
  adjustment,
  items,
  currency,
  decimalPlaces,
  onCancel,
  onSave,
  onDelete,
}: {
  // null adds a new line.
  adjustment: ReceiptAdjustment | null;
  items: ReceiptItem[];
  currency: string | null;
  decimalPlaces: number;
  onCancel: () => void;
  onSave: (adjustment: ReceiptAdjustment) => void;
  onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState(adjustment?.printed_label ?? '');
  const [kind, setKind] = useState<AdjustmentKind>(adjustment?.kind ?? 'discount');
  const [amountText, setAmountText] = useState(adjustment ? String(adjustment.amount) : '');
  // A line the receipt does not settle starts with nothing chosen, so the
  // model's guess is never confirmed by accident. A new line covers everything.
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        adjustment === null
          ? items.map(({ item_order }) => item_order)
          : adjustment.status === 'unresolved'
            ? []
            : adjustment.item_orders,
      ),
  );
  const amount = parseReceiptAmount(amountText);
  const symbol = currencySymbol(currency);
  const percentage = adjustment?.percentage ?? null;
  const unit = 10 ** -decimalPlaces;
  // The printed percent of an item's printed price is (to the unit) the amount.
  const fits = (item: ReceiptItem) =>
    percentage !== null &&
    Number.isFinite(amount) &&
    Math.abs((printedPrice(item) * percentage) / 100 - amount) < unit;
  const allChosen = items.length > 0 && items.every(({ item_order }) => chosen.has(item_order));
  const canSave = Number.isFinite(amount) && amount > 0 && chosen.size > 0;

  function toggle(order: number) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  }

  function save() {
    onSave({
      printed_label: label.trim() || KIND_LABELS[kind],
      kind,
      amount,
      percentage,
      eligible_subtotal: adjustment?.eligible_subtotal ?? null,
      item_orders: items.map(({ item_order }) => item_order).filter((order) => chosen.has(order)),
      status: 'verified',
      allocations: [],
    });
  }

  const printed = [
    percentage !== null ? `${percentage}%` : null,
    adjustment?.eligible_subtotal != null
      ? `of ${formatMoney(adjustment.eligible_subtotal, currency)}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Text style={styles.title}>
            {adjustment ? adjustment.printed_label || KIND_LABELS[adjustment.kind] : 'Add a line'}
          </Text>
          {printed ? <Text style={styles.hint}>Printed as {printed}</Text> : null}

          <View style={styles.kinds}>
            {KINDS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: kind === option }}
                style={[styles.tab, kind === option && styles.selected]}
                testID={`adjustment-kind-${option}`}
                onPress={() => setKind(option)}
              >
                <Text style={styles.label}>{KIND_LABELS[option]}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fields}>
            {adjustment === null && (
              <TextInput
                style={[styles.input, styles.labelInput]}
                testID="adjustment-label"
                accessibilityLabel="Label"
                value={label}
                onChangeText={setLabel}
                placeholder="Label, e.g. Coupon"
                placeholderTextColor={theme.inkFaint}
              />
            )}
            <View style={[styles.input, styles.amountField]}>
              {symbol && <Text style={styles.symbol}>{symbol}</Text>}
              <TextInput
                style={styles.amountInput}
                testID="adjustment-amount"
                accessibilityLabel="Amount"
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                selectTextOnFocus
                placeholder="Amount"
                placeholderTextColor={theme.inkFaint}
              />
            </View>
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.hint}>Applies to</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allChosen }}
              onPress={() =>
                setChosen(new Set(allChosen ? [] : items.map(({ item_order }) => item_order)))
              }
              testID="adjustment-all-items"
              hitSlop={8}
            >
              <Text style={styles.link}>{allChosen ? 'Clear' : 'All items'}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list}>
            {items.map((item) => {
              const checked = chosen.has(item.item_order);
              return (
                <Pressable
                  key={item.item_order}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => toggle(item.item_order)}
                  testID={`adjustment-item-${item.item_order}`}
                  style={[styles.item, checked && styles.selected]}
                >
                  <View style={styles.itemText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.english_name || item.japanese_name}
                    </Text>
                    <Text style={styles.price}>
                      {formatMoney(printedPrice(item), currency)}
                      {fits(item) ? ` · ${percentage}% matches` : ''}
                    </Text>
                  </View>
                  {checked && <Text style={styles.label}>✓</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            {onDelete && (
              <PressableScale
                style={styles.action}
                onPress={onDelete}
                testID="adjustment-delete"
                accessibilityLabel="Remove this line"
              >
                <Text style={styles.danger}>Remove</Text>
              </PressableScale>
            )}
            <PressableScale style={styles.action} onPress={onCancel} testID="adjustment-cancel">
              <Text style={styles.label}>Cancel</Text>
            </PressableScale>
            <PressableScale
              style={[styles.action, styles.primary, !canSave && styles.disabled]}
              onPress={save}
              disabled={!canSave}
              testID="adjustment-done"
            >
              <Text style={styles.primaryText}>Apply</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,11,15,0.42)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radiusXl,
    borderTopRightRadius: theme.radiusXl,
    gap: 12,
    padding: 20,
  },
  title: { ...type.title, color: theme.ink },
  hint: { ...type.label, color: theme.inkMuted },
  label: { ...type.label, color: theme.ink },
  link: { ...type.label, color: theme.accentInk },
  danger: { ...type.label, color: theme.danger },
  kinds: { flexDirection: 'row', gap: 8 },
  tab: {
    minHeight: 44,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.surfaceAlt,
    borderRadius: theme.radiusSm,
  },
  selected: { backgroundColor: theme.accentBg },
  fields: { flexDirection: 'row', gap: 8 },
  input: {
    ...type.body,
    minHeight: 48,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    color: theme.ink,
  },
  labelInput: { flex: 1.4 },
  amountField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  symbol: { ...type.body, color: theme.inkMuted },
  amountInput: { ...type.body, ...type.numeral, flex: 1, minHeight: 46, color: theme.ink },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { flexGrow: 0, flexShrink: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  itemText: { flex: 1, gap: 2 },
  name: { ...type.body, color: theme.ink },
  price: { ...type.label, ...type.numeral, color: theme.inkMuted },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  primary: { backgroundColor: theme.ink },
  primaryText: { ...type.body, color: theme.surface },
  disabled: { opacity: 0.4 },
});
