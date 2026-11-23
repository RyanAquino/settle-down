import { z } from 'zod';
import {
  allocationRequest,
  allocationSchema,
  type ReceiptAdjustment,
  type ReceiptAllocation,
  type ReceiptData,
} from '@/utils/receipt';

export type Recalculation = { allocation: ReceiptAllocation } | { error: string };

const rejectionSchema = z.object({ detail: z.string() });

// Asks the backend to split the receipt again with the deductions as a person
// corrected them. The money math stays on the server; this only carries the
// receipt there and back. Never throws: failures come back as a message.
export async function recalculateReceipt(
  apiBaseUrl: string,
  receipt: ReceiptData,
  adjustments: ReceiptAdjustment[],
): Promise<Recalculation> {
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': 'true',
    'Content-Type': 'application/json',
  };
  const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/receipts/allocations/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(allocationRequest(receipt, adjustments)),
    });
  } catch {
    return { error: 'Couldn’t reach the server. Check your connection and try again.' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 422) {
    const rejection = rejectionSchema.safeParse(body);
    return {
      error: rejection.success
        ? rejection.data.detail
        : 'These discounts can’t be applied to the items chosen.',
    };
  }
  const parsed = allocationSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    return { error: 'Couldn’t recalculate the receipt. Please try again.' };
  }
  return { allocation: parsed.data };
}
