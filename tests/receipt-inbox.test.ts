import sugi from '../tools/verify-ios/fixtures/sugi-receipt.json';
import { readReceipt } from '@/utils/receipt';
import { reconcileReceipt } from '@/utils/receipt-preview';
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
import { Directory, File, Paths, samplePhoto, setupInboxFiles } from './support/inbox-files';

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

test('revisiting the inbox finishes an interrupted discard and removes unfinished photo copies', async () => {
  const inbox = new Directory(Paths.document, 'receipt-inbox');
  const draft = await createPhotoDraft(samplePhoto().uri);
  const discarded = new Directory(inbox, draft.id);
  discarded.rename('removed-' + draft.id);
  const interrupted = new Directory(inbox, 'import-' + randomUUID());
  interrupted.create();
  new File(interrupted, 'photo.jpg').writeSync('partial photo');
  const unrelated = new Directory(inbox, 'import-other');
  unrelated.create();

  expect(listDrafts()).toEqual([]);
  expect(discarded.exists).toBe(false);
  expect(interrupted.exists).toBe(false);
  expect(unrelated.exists).toBe(true);
});

test('a staged receipt with a committed snapshot is recovered after restart', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  new Directory(Paths.document, 'receipt-inbox', draft.id).rename('import-' + draft.id);
  expect(listDrafts()).toEqual([draft]);
  expect(new File(draftPhotoUri(draft)).textSync()).toBe('receipt photo');
  expect(listDrafts()).toEqual([draft]);
});

test('opening the inbox during an active import leaves its photo copy alone', async () => {
  const pending = createPhotoDraft(samplePhoto().uri);
  expect(listDrafts()).toEqual([]);
  const draft = await pending;
  expect(listDrafts()).toEqual([draft]);
});

test('a legacy draft keeps coupon eligibility and price edits when reopened and saved', async () => {
  const draft = await createPhotoDraft(samplePhoto().uri);
  const { receipt_discount, points_redeemed, split_rules, ...legacy } = sugi;
  const edits = {
    costs: { '1': '1087', '3': '1863' },
    tax: '0',
    date: sugi.receipt_date,
    group: null,
    members: [],
    payer: '',
    assignments: { '1': 'aya' },
  };
  const file = new File(Paths.document, 'receipt-inbox', draft.id, 'draft.json');
  file.writeSync(
    JSON.stringify({
      ...draft,
      edits,
      receipt: {
        ...legacy,
        receipt_adjustments: [
          { kind: 'discount', amount: receipt_discount, item_orders: [1, 2, 5, 6] },
          { kind: 'points_redemption', amount: points_redeemed },
        ],
      },
    }),
  );
  const reopened = readDraft(draft.id)!;
  expect(reopened.receipt?.receipt_items).toEqual(readReceipt(sugi)?.receipt_items);
  expect(reopened.edits).toEqual(edits);
  saveDraft(reopened);
  const saved: unknown = JSON.parse(file.textSync());
  expect(saved).toMatchObject({
    receipt: {
      receipt_discount,
      points_redeemed,
      split_rules: {
        discounts: [{ scope: 'items', item_orders: split_rules.discounts[0].item_orders }],
        points: [{ scope: 'basket', amount: 494 }],
      },
    },
  });
  expect(saved).not.toHaveProperty('receipt.receipt_adjustments');

  const receipt = readDraft(draft.id)!.receipt!;
  const receipt_items = receipt.receipt_items.map((item) => ({
    ...item,
    cost: Number(reopened.edits!.costs[item.item_order] ?? item.cost),
  }));
  const result = reconcileReceipt({ ...receipt, receipt_items });
  expect(result?.total).toBe(5809);
  expect(result?.adjustedItems?.map(({ cost }) => cost)).toEqual([924, 746, 1717, 1534, 652, 236]);
});
