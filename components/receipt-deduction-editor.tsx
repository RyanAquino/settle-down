import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatMoney,
  parseReceiptAmount,
  type ReceiptItem,
  type SplitDeduction,
} from '@/utils/receipt';
import { theme, type } from '@/utils/theme';

type Props = {
  title: string;
  initial?: SplitDeduction;
  currency: string | null;
  items: ReceiptItem[];
  remainingItems?: ReceiptItem[] | null;
  // Item coupons have a fixed original price. Checkout deductions have a scope.
  originalPrice?: number;
  onSave: (deduction: SplitDeduction) => void;
  onRemove?: () => void;
  onClose: () => void;
};

export default function ReceiptDeductionEditor({
  title,
  initial,
  currency,
  items,
  originalPrice,
  remainingItems,
  onSave,
  onRemove,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [base, setBase] = useState(initial?.eligible_subtotal?.toString() ?? '');
  const [scope, setScope] = useState<SplitDeduction['scope']>(initial?.scope ?? 'basket');
  const [orders, setOrders] = useState(initial?.item_orders ?? []);
  const value = parseReceiptAmount(amount);
  const target = base.trim() ? parseReceiptAmount(base) : null;
  const selected =
    scope === 'basket' ? items : items.filter((item) => orders.includes(item.item_order));
  const subtotal = selected.reduce((sum, item) => sum + item.cost, 0);
  const remaining = remainingItems
    ?.filter((item) => scope === 'basket' || orders.includes(item.item_order))
    .reduce((sum, item) => sum + item.cost, 0);
  const remainingDiffers = remaining !== undefined && Math.abs(remaining - subtotal) > 1e-7;
  const itemCoupon = originalPrice !== undefined;
  const completeScope = scope === 'basket' || (scope === 'items' && selected.length > 0);
  const matchesTarget =
    target === null ||
    (target > 0 &&
      (Math.abs(subtotal - target) < 1e-7 ||
        (remaining !== undefined && Math.abs(remaining - target) < 1e-7)));
  const canSave =
    value > 0 &&
    Number.isFinite(value) &&
    (itemCoupon ? value <= originalPrice : completeScope && matchesTarget);
  function save() {
    if (!canSave) return;
    onSave({
      ...initial,
      amount: value,
      scope,
      eligible_subtotal: target,
      item_orders: scope === 'items' ? orders : [],
    });
  }
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.title}>{title}</Text>
          {!!initial?.printed_label && <Text style={styles.hint}>{initial.printed_label}</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.fields}>
            {itemCoupon && (
              <Text style={styles.label}>
                Original price · {formatMoney(originalPrice, currency)}
              </Text>
            )}
            <Text style={styles.label}>Deduction amount</Text>
            <TextInput
              accessibilityLabel="Deduction amount"
              testID="deduction-amount"
              keyboardType="decimal-pad"
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              selectTextOnFocus
              placeholder="0"
            />
            {itemCoupon ? (
              <Text style={styles.hint}>
                After item coupon · {formatMoney(originalPrice - value, currency)}
              </Text>
            ) : (
              <>
                <Text style={styles.label}>Eligible subtotal on receipt</Text>
                <TextInput
                  accessibilityLabel="Eligible subtotal on receipt"
                  testID="deduction-base"
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={base}
                  onChangeText={setBase}
                  selectTextOnFocus
                  placeholder="Optional"
                />
                <Text style={styles.label}>Applies to</Text>
                <View style={styles.actions}>
                  {(['basket', 'items'] as const).map((mode) => (
                    <Pressable
                      key={mode}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: scope === mode }}
                      testID={`deduction-scope-${mode}`}
                      style={[styles.option, scope === mode && styles.selected]}
                      onPress={() => setScope(mode)}
                    >
                      <Text style={styles.label}>
                        {mode === 'basket' ? 'Whole basket' : 'Select items'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {scope !== 'basket' &&
                  items.map((item) => {
                    const checked = orders.includes(item.item_order);
                    return (
                      <Pressable
                        key={item.item_order}
                        style={[styles.option, checked && styles.selected]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        testID={`deduction-item-${item.item_order}`}
                        onPress={() => {
                          setScope('items');
                          setOrders((previous) =>
                            previous.includes(item.item_order)
                              ? previous.filter((order) => order !== item.item_order)
                              : [...previous, item.item_order],
                          );
                        }}
                      >
                        <Text style={styles.label}>
                          {checked ? '✓ ' : ''}
                          {item.english_name || item.japanese_name} ·{' '}
                          {formatMoney(item.cost, currency)}
                        </Text>
                      </Pressable>
                    );
                  })}
                <Text style={styles.hint}>
                  Selected · {formatMoney(remaining ?? subtotal, currency)}
                  {target !== null ? ` / ${formatMoney(target, currency)} on receipt` : ''}
                </Text>
                {remainingDiffers && (
                  <Text style={styles.hint}>
                    Before checkout deductions · {formatMoney(subtotal, currency)}
                  </Text>
                )}
              </>
            )}
          </ScrollView>
          <View style={styles.actions}>
            {onRemove && (
              <Pressable
                accessibilityRole="button"
                testID="deduction-remove"
                style={styles.option}
                onPress={onRemove}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={styles.option} onPress={onClose}>
              <Text style={styles.label}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              testID="deduction-save"
              disabled={!canSave}
              style={[styles.save, !canSave && styles.disabled]}
              onPress={save}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,11,15,0.42)' },
  sheet: {
    maxHeight: '88%',
    padding: 20,
    gap: 12,
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radiusXl,
    borderTopRightRadius: theme.radiusXl,
  },
  title: { ...type.title, color: theme.ink },
  label: { ...type.label, color: theme.ink },
  hint: { ...type.label, color: theme.inkMuted },
  fields: { gap: 10, paddingVertical: 4 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  input: {
    ...type.body,
    ...type.numeral,
    color: theme.ink,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.borderStrong,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surfaceAlt,
    justifyContent: 'center',
  },
  selected: { backgroundColor: theme.accentBg, borderWidth: 1, borderColor: theme.accent },
  save: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.accent,
  },
  saveText: { ...type.label, color: theme.surface },
  disabled: { opacity: 0.35 },
  remove: { ...type.label, color: theme.danger },
});
