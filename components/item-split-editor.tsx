import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/motion';
import { formatMoney, type GroupUser, type ItemSplit, type ReceiptItem } from '@/utils/receipt';
import { theme, type } from '@/utils/theme';

export default function ItemSplitEditor({
  item,
  users,
  currency,
  initial,
  onCancel,
  onSave,
}: {
  item: ReceiptItem;
  users: GroupUser[];
  currency: string | null;
  initial?: ItemSplit;
  onCancel: () => void;
  onSave: (split: ItemSplit) => void;
}) {
  const insets = useSafeAreaInsets();
  const canSplitByQuantity = Number.isInteger(item.quantity) && item.quantity > 1;
  const modes = canSplitByQuantity ? (['equal', 'quantity'] as const) : (['equal'] as const);
  const [mode, setMode] = useState<ItemSplit['mode']>(initial?.mode ?? 'equal');
  const [equalMembers, setEqualMembers] = useState(
    () =>
      new Set(initial?.mode === 'equal' ? initial.portions.map(({ memberId }) => memberId) : []),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initial?.mode === 'quantity'
        ? initial.portions.map(({ memberId, units }) => [memberId, units])
        : [],
    ),
  );
  const remaining =
    item.quantity - users.reduce((sum, user) => sum + (quantities[user.id] ?? 0), 0);
  const portions = users
    .map(({ id }) => ({
      memberId: id,
      units: mode === 'equal' ? Number(equalMembers.has(id)) : (quantities[id] ?? 0),
    }))
    .filter(({ units }) => units > 0);
  const canSave = portions.length > 0 && (mode === 'equal' || remaining === 0);

  function toggleMember(memberId: string) {
    setEqualMembers((previous) => {
      const next = new Set(previous);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function changeQuantity(id: string, delta: number) {
    setQuantities((previous) => {
      const next = { ...previous, [id]: Math.max(0, (previous[id] ?? 0) + delta) };
      const assigned = users.reduce((sum, user) => sum + (next[user.id] ?? 0), 0);
      return assigned <= item.quantity ? next : previous;
    });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Text style={styles.title}>{item.english_name || item.japanese_name}</Text>
          <Text style={styles.hint}>{formatMoney(item.cost, currency)}</Text>

          {canSplitByQuantity && (
            <View style={styles.modes}>
              {modes.map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === option }}
                  style={[styles.tab, mode === option && styles.selected]}
                  testID={`split-mode-${option}`}
                  onPress={() => setMode(option)}
                >
                  <Text style={styles.label}>{option === 'equal' ? 'Equal' : 'By quantity'}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.hint} accessibilityLiveRegion="polite">
            {mode === 'equal'
              ? 'Choose who shared this item'
              : `${remaining} of ${item.quantity} left to assign`}
          </Text>
          <ScrollView style={styles.roster}>
            {users.map(({ id, name }) => {
              const units = quantities[id] ?? 0;
              const checked = equalMembers.has(id);
              return mode === 'equal' ? (
                <Pressable
                  key={id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => toggleMember(id)}
                  testID={`split-select-${id}`}
                  style={[styles.person, checked && styles.selected]}
                >
                  <Text style={styles.name}>{name}</Text>
                  {checked && <Text style={styles.label}>✓</Text>}
                </Pressable>
              ) : (
                <View key={id} style={styles.person}>
                  <Text style={styles.name}>{name}</Text>
                  <View style={styles.stepper}>
                    <PressableScale
                      style={[styles.step, units === 0 && styles.disabled]}
                      disabled={units === 0}
                      accessibilityLabel={`Remove one from ${name}`}
                      onPress={() => changeQuantity(id, -1)}
                      testID={`split-remove-${id}`}
                    >
                      <Text style={styles.label}>−</Text>
                    </PressableScale>
                    <Text style={styles.units} accessibilityLabel={`${units} assigned to ${name}`}>
                      {units}
                    </Text>
                    <PressableScale
                      style={[styles.step, remaining === 0 && styles.disabled]}
                      disabled={remaining === 0}
                      accessibilityLabel={`Add one to ${name}`}
                      onPress={() => changeQuantity(id, 1)}
                      testID={`split-add-${id}`}
                    >
                      <Text style={styles.label}>+</Text>
                    </PressableScale>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <PressableScale style={styles.action} onPress={onCancel} testID="split-cancel">
              <Text style={styles.label}>Cancel</Text>
            </PressableScale>
            <PressableScale
              style={[styles.action, styles.primary, !canSave && styles.disabled]}
              onPress={() => onSave({ mode, portions })}
              disabled={!canSave}
              testID="split-done"
            >
              <Text style={styles.primaryText}>Done</Text>
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
    maxHeight: '85%',
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radiusXl,
    borderTopRightRadius: theme.radiusXl,
    gap: 12,
    padding: 20,
  },
  title: { ...type.title, color: theme.ink },
  hint: { ...type.label, color: theme.inkMuted },
  label: { ...type.label, color: theme.ink },
  modes: { flexDirection: 'row', gap: 8 },
  tab: {
    minHeight: 44,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.surfaceAlt,
    borderRadius: theme.radiusSm,
  },
  selected: { backgroundColor: theme.accentBg },
  roster: { flexGrow: 0, flexShrink: 1 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 8,
  },
  name: { ...type.body, flex: 1, color: theme.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: {
    width: 44,
    height: 44,
    borderRadius: theme.radiusSm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  units: { ...type.body, ...type.numeral, minWidth: 24, textAlign: 'center', color: theme.ink },
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
