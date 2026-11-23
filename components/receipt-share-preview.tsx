import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/motion';
import { formatMoney } from '@/utils/receipt';
import type { previewReceipt } from '@/utils/receipt-preview';
import { theme, type } from '@/utils/theme';

export default function ReceiptSharePreview({
  shares,
  currency,
  total,
  title,
  taxIncluded,
  adjusted,
  onClose,
}: {
  shares: ReturnType<typeof previewReceipt>;
  currency: string | null;
  total: number;
  title: string;
  taxIncluded: boolean;
  adjusted: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const money = (amount: number) => formatMoney(amount, currency);
  const adjustmentNote = 'Item shares include receipt deductions and any tax.';
  const taxLabel = taxIncluded ? 'Tax included' : 'Tax';
  const itemLabel = (line: { name: string; portion?: string }) =>
    line.portion ? `${line.name} · ${line.portion}` : line.name;

  async function shareBreakdown() {
    const summaries = shares.map((share) =>
      [
        `${share.user.name} · Estimated share ${money(share.total)}`,
        ...share.lines.map((line) => `• ${itemLabel(line)} · ${money(line.amount)}`),
        ...(adjusted ? [] : [taxIncluded ? taxLabel : `${taxLabel} · ${money(share.taxAmount)}`]),
        ...(share.rounding ? [`Rounding · ${money(share.rounding)}`] : []),
      ].join('\n'),
    );
    try {
      await Share.share({
        title,
        message: [
          `${title} · Receipt total ${money(total)}`,
          ...(adjusted ? [adjustmentNote] : []),
          ...summaries,
        ].join('\n\n'),
      });
    } catch {
      Alert.alert('Couldn’t share the breakdown', 'Please try again.');
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.row}>
            <View style={styles.heading}>
              <Text style={styles.title}>Show me my share</Text>
              <Text style={styles.muted}>Receipt total · {money(total)}</Text>
              {adjusted && <Text style={styles.muted}>{adjustmentNote}</Text>}
            </View>
            <PressableScale onPress={onClose} style={styles.close}>
              <Text style={styles.label}>Close</Text>
            </PressableScale>
          </View>
          <ScrollView style={styles.people}>
            {shares.map((share) => {
              const expanded = expandedId === share.user.id;
              return (
                <View key={share.user.id} style={styles.person}>
                  <Pressable
                    style={[styles.row, styles.personHeader]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    testID={`share-member-${share.user.id}`}
                    onPress={() => setExpandedId(expanded ? null : share.user.id)}
                  >
                    <Text style={[styles.label, styles.name]}>{share.user.name}</Text>
                    <View style={styles.amount}>
                      <Text style={styles.muted}>Estimated share</Text>
                      <Text style={styles.label}>{money(share.total)}</Text>
                    </View>
                    <Text style={styles.label}>{expanded ? '−' : '+'}</Text>
                  </Pressable>
                  {expanded && (
                    <View style={styles.details}>
                      {share.lines.map((line) => (
                        <View key={line.id} style={styles.row}>
                          <Text style={[styles.muted, styles.name]}>{itemLabel(line)}</Text>
                          <Text style={styles.label}>{money(line.amount)}</Text>
                        </View>
                      ))}
                      {!adjusted && (
                        <View style={styles.row}>
                          <Text style={styles.muted}>{taxLabel}</Text>
                          {!taxIncluded && (
                            <Text style={styles.label}>{money(share.taxAmount)}</Text>
                          )}
                        </View>
                      )}
                      {!!share.rounding && (
                        <View style={styles.row}>
                          <Text style={styles.muted}>Rounding</Text>
                          <Text style={styles.label}>{money(share.rounding)}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <PressableScale
            style={styles.primary}
            onPress={() => {
              void shareBreakdown();
            }}
            testID="share-receipt-breakdown"
          >
            <Text style={styles.primaryText}>Share breakdown</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,11,15,0.42)' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radiusXl,
    borderTopRightRadius: theme.radiusXl,
    gap: 16,
    padding: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { flex: 1, gap: 6 },
  title: { ...type.title, color: theme.ink },
  label: { ...type.body, color: theme.ink },
  muted: { ...type.label, color: theme.inkMuted },
  close: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surfaceAlt,
  },
  people: { flexGrow: 0, flexShrink: 1 },
  person: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  personHeader: { paddingVertical: 12, minHeight: 60 },
  name: { flex: 1 },
  amount: { alignItems: 'flex-end', gap: 2 },
  details: {
    marginBottom: 8,
    padding: 12,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surfaceAlt,
    gap: 8,
  },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderRadius: theme.radius,
    backgroundColor: theme.ink,
  },
  primaryText: { ...type.body, color: theme.surface },
});
