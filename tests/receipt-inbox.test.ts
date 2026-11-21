import { uuid } from 'expo';
import { randomUUID } from 'node:crypto';
import {
  createPhotoDraft,
  draftPhotoUri,
  listDrafts,
  readDraft,
  removeDraft,
  saveDraft,
} from '@/utils/receipt-inbox';
import { File, Paths, samplePhoto, setupInboxFiles } from './support/inbox-files';

jest.mock('expo-file-system', () =>
  jest.requireActual<typeof import('./support/inbox-files')>('./support/inbox-files'),
);
setupInboxFiles();
beforeEach(() => jest.spyOn(uuid, 'v4').mockImplementation(randomUUID));
afterEach(() => jest.restoreAllMocks());

test('each capture owns a durable photo and removing one leaves the other draft and its source alone', async () => {
  const source = samplePhoto();
  const first = await createPhotoDraft(source.uri);
  const second = await createPhotoDraft(source.uri);
  expect(listDrafts().map((draft) => draft.id)).toEqual(
    expect.arrayContaining([first.id, second.id]),
  );
  removeDraft(first.id);
  expect(source.exists).toBe(true);
  source.delete();
  expect(new File(draftPhotoUri(second)).textSync()).toBe('receipt photo');
  expect(new File(draftPhotoUri(first)).exists).toBe(false);
  expect(listDrafts()).toEqual([second]);
  expect(() => saveDraft(first)).toThrow();
});

test('an interrupted snapshot replacement reopens the last complete draft', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  saveDraft({
    ...draft,
    edits: {
      costs: {},
      tax: '10',
      date: new Date().toISOString(),
      group: null,
      members: [],
      payer: '',
      assignments: {},
    },
  });
  const file = new File(Paths.document, 'receipt-inbox', draft.id, 'draft.json');
  file.rename('unfinished.json');
  expect(readDraft(draft.id)).toEqual(draft);
  expect(readDraft('../outside')).toBeNull();
});

test('failed imports leave no visible draft', async () => {
  await expect(createPhotoDraft(new File(Paths.document, 'missing.jpg').uri)).rejects.toThrow();
  expect(listDrafts()).toEqual([]);
});
