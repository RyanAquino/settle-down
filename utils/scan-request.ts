import { uuid } from 'expo';

type ScanInput =
  | { photoUri: string; fromLibrary?: boolean; verifyOfflineImport?: boolean }
  | { draftId: string; photoUri: string; reminder?: string };

const pending = new Map<string, ScanInput>();

// Public routes carry only the ID. In-app selections and reminder taps supply the scan input.
export function prepareScan(input: ScanInput) {
  const id = uuid.v4();
  pending.set(id, input);
  return { pathname: '/loading' as const, params: { scanId: id } };
}

export function pendingScan(id: string) {
  return pending.get(id);
}

export function releaseScan(id: string) {
  pending.delete(id);
}
