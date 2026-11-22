import { uuid } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';
import { groupSchema, groupUserSchema, itemAssignmentSchema, receiptSchema } from '@/utils/receipt';

const editorSchema = z.object({
  costs: z.record(z.string(), z.string()),
  tax: z.string(),
  date: z.iso.datetime(),
  group: groupSchema.nullable(),
  members: z.array(groupUserSchema),
  payer: z.string(),
  assignments: z.record(z.string(), itemAssignmentSchema),
});
export type ReceiptEdits = z.output<typeof editorSchema>;

const storedDraft = z.object({
  createdAt: z.number(),
  photoName: z.string().regex(/^photo\.[a-z0-9]{1,10}$/),
  receipt: receiptSchema.nullable(),
  edits: editorSchema.nullable(),
});
export type ReceiptDraft = z.output<typeof storedDraft> & { id: string };

const activeImports = new Set<string>();
const root = () => new Directory(Paths.document, 'receipt-inbox');
const directory = (id: string) => new Directory(root(), z.uuid().parse(id));
export const draftPhotoUri = (draft: ReceiptDraft) =>
  new File(directory(draft.id), draft.photoName).uri;

function writeSnapshot(dir: Directory, draft: ReceiptDraft) {
  const next = new File(dir, 'next.json');
  next.writeSync(JSON.stringify(draft));
  // Overwriting a file in place can truncate the only good copy if the app stops.
  // Keep the last complete version until its replacement is in place.
  const current = new File(dir, 'draft.json');
  if (current.exists) current.moveSync(new File(dir, 'previous.json'), { overwrite: true });
  next.rename('draft.json');
}

export async function createPhotoDraft(uri: string): Promise<ReceiptDraft> {
  const id = uuid.v4();
  const dir = new Directory(root(), 'import-' + id);
  dir.create({ intermediates: true });
  activeImports.add(id);
  try {
    const source = new File(uri);
    const extension = source.extension.toLowerCase();
    const photoName = 'photo' + (/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.jpg');
    const draft = { id, photoName, createdAt: Date.now(), receipt: null, edits: null };
    await source.copy(new File(dir, photoName));
    writeSnapshot(dir, draft);
    dir.rename(id);
    return draft;
  } catch (error) {
    if (dir.exists) dir.delete();
    throw error;
  } finally {
    activeImports.delete(id);
  }
}

export function readDraft(id: string): ReceiptDraft | null {
  if (!z.uuid().safeParse(id).success) return null;
  const dir = directory(id);
  for (const name of ['draft.json', 'previous.json']) {
    const file = new File(dir, name);
    if (file.exists) {
      try {
        return { ...storedDraft.parse(JSON.parse(file.textSync())), id };
      } catch {
        // Recover the preceding committed edit if the newest snapshot is unreadable.
      }
    }
  }
  return null;
}

function readInboxEntry(dir: Directory) {
  const staged = /^(import|removed)-(.+)$/.exec(dir.name);
  if (!staged) return readDraft(dir.name);
  const [, operation, id] = staged;
  if (!z.uuid().safeParse(id).success || activeImports.has(id)) return null;

  // A stopped app can leave a photo behind either side of the final rename.
  // draft.json is committed only after the asynchronous copy has completed.
  try {
    if (operation === 'import' && new File(dir, 'draft.json').exists && !directory(id).exists) {
      dir.rename(id);
      return readDraft(id);
    }
    dir.delete();
  } catch {
    // A later visit retries cleanup without blocking access to other receipts.
  }
  return null;
}

export function listDrafts() {
  const inbox = root();
  if (!inbox.exists) return [];
  return inbox
    .list()
    .filter((entry) => entry instanceof Directory)
    .map(readInboxEntry)
    .filter((draft) => draft !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function saveDraft(draft: ReceiptDraft) {
  // Never recreate a discarded or submitted draft from a late callback.
  writeSnapshot(directory(draft.id), draft);
}

export function removeDraft(id: string) {
  const dir = directory(id);
  if (!dir.exists) return;
  // Remove from the inbox before deleting the large photo and the snapshots.
  dir.rename('removed-' + id);
  dir.delete();
}
