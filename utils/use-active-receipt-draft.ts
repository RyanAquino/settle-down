import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { setActiveReceiptDraft } from '@/utils/receipt-reminder-lifecycle';

export function useActiveReceiptDraft(id: string | undefined) {
  useFocusEffect(useCallback(() => (id ? setActiveReceiptDraft(id) : undefined), [id]));
}
