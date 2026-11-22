import { useState } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/motion';
import type { ReceiptDraft } from '@/utils/receipt-inbox';
import { theme, type } from '@/utils/theme';

type Inspector = {
  inspectSchedule: (createdAt: Record<string, number>) => Promise<string[]>;
};

export function ReminderScheduleInspector({ drafts }: { drafts: ReceiptDraft[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  async function inspect() {
    setOpen(true);
    setLines([]);
    try {
      const reader = requireOptionalNativeModule<Inspector>('ReceiptReminderCalendar');
      if (!reader?.inspectSchedule) throw new Error('Simulator inspection unavailable');
      const createdAt = Object.fromEntries(drafts.map((draft) => [draft.id, draft.createdAt]));
      setLines(await reader.inspectSchedule(createdAt));
    } catch {
      setLines(['Could not read the simulator notification schedule']);
    }
  }
  return (
    <>
      <PressableScale
        testID="verify-read-schedule"
        style={styles.action}
        onPress={() => void inspect()}
      >
        <Text style={styles.link}>Inspect reminder schedule</Text>
      </PressableScale>
      <Modal visible={open} onRequestClose={() => setOpen(false)} presentationStyle="pageSheet">
        <View style={styles.panel}>
          <Text style={styles.title}>Pending receipt reminders</Text>
          <ScrollView contentContainerStyle={styles.rows}>
            {lines.map((line, index) => (
              <Text key={index} style={styles.row}>
                {line}
              </Text>
            ))}
          </ScrollView>
          <PressableScale
            testID="verify-refresh-schedule"
            style={styles.action}
            onPress={() => void inspect()}
          >
            <Text style={styles.link}>Refresh schedule</Text>
          </PressableScale>
          <PressableScale
            testID="verify-close-schedule"
            style={styles.action}
            onPress={() => setOpen(false)}
          >
            <Text style={styles.link}>Close schedule</Text>
          </PressableScale>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, padding: 24, paddingBottom: 42, gap: 12, backgroundColor: theme.bg },
  rows: { gap: 8 },
  row: { ...type.body, ...type.numeral, color: theme.ink },
  title: { ...type.title, color: theme.ink },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  link: { ...type.label, color: theme.accent },
});
