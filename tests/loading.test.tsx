import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import * as MediaLibrary from 'expo-media-library/legacy';
import { createPhotoDraft, readDraft, saveDraft, removeDraft } from '@/utils/receipt-inbox';
import { Alert } from 'react-native';
import LoadingScreen from '../app/loading';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true, type: 'wifi' }),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-media-library/legacy', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}));
jest.mock('@/utils/receipt-inbox', () => ({
  createPhotoDraft: jest.fn(),
  readDraft: jest.fn(),
  draftPhotoUri: () => 'file:///documents/inbox/photo.jpg',
  saveDraft: jest.fn(),
  removeDraft: jest.fn(),
}));
const draft = { id: 'draft-1', createdAt: 1, photoName: 'photo.jpg', receipt: null, edits: null };
const durableUri = 'file:///documents/inbox/photo.jpg';

const receipt = {
  receipt_items: [
    {
      english_name: 'Tea',
      japanese_name: 'お茶',
      item_order: 1,
      cost: 100,
      quantity: 1,
      discount: 0,
    },
  ],
  en_shop_name: 'Shop',
  jp_shop_name: '店',
  tax_percentage: 0,
  total_amount: 100,
  receipt_date: '2026-11-16T00:00:00Z',
};

function scanResponse(total_amount: number) {
  return { ok: true, json: () => Promise.resolve({ ...receipt, total_amount }) } as Response;
}

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ photoUri: 'file:///receipt.jpg' });
  jest.mocked(createPhotoDraft).mockResolvedValue(draft);
  jest
    .mocked(NetInfo.fetch)
    .mockResolvedValue({ isConnected: true } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('a reconciled scan proceeds directly to the receipt', async () => {
  const scan = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(scanResponse(100));
  await render(<LoadingScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(scan).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveDraft).mock.calls[0][0]).toMatchObject({
    id: draft.id,
    receipt: { total_amount: 100 },
  });
});

test('an inconsistent scan retries the same photo and opens the reconciled receipt', async () => {
  const scan = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(scanResponse(120))
    .mockResolvedValueOnce(scanResponse(100));

  await render(<LoadingScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(scan).toHaveBeenCalledTimes(2);
  expect(jest.mocked(File).mock.calls).toEqual([[durableUri], [durableUri]]);
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/receipt-details',
    params: {
      data: JSON.stringify({ ...receipt, receipt_date: '2026-11-16T00:00:00.000Z' }),
      photoUri: durableUri,
      draftId: draft.id,
    },
  });
});

test('two inconsistent scans show the original photo and let the payer retake it', async () => {
  const scan = jest.spyOn(globalThis, 'fetch').mockResolvedValue(scanResponse(120));
  const user = userEvent.setup();

  await render(<LoadingScreen />);
  const retake = await screen.findByRole('button', { name: 'Retake photo' });
  expect(screen.getByLabelText('Original receipt photo')).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
  expect(scan).toHaveBeenCalledTimes(2);
  await user.press(retake);
  expect(removeDraft).toHaveBeenCalledWith(draft.id);
  expect(router.back).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'offline photos are queued even without Photos access (fromLibrary=%s)',
  async (fromLibrary) => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ photoUri: 'file:///receipt.jpg', fromLibrary: String(fromLibrary) });
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    jest
      .mocked(MediaLibrary.requestPermissionsAsync)
      .mockRejectedValue(new Error('Permission denied'));
    const upload = jest.spyOn(globalThis, 'fetch');
    await render(<LoadingScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/inbox'));
    expect(createPhotoDraft).toHaveBeenCalledTimes(1);
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledTimes(fromLibrary ? 0 : 1);
    expect(upload).not.toHaveBeenCalled();
  },
);

test('resuming a queued photo scans its durable copy and promotes the same draft', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ draftId: draft.id, photoUri: durableUri });
  jest.mocked(readDraft).mockReturnValue(draft);
  jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(scanResponse(100));
  await render(<LoadingScreen />);
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/receipt-details' }),
    ),
  );
  expect(createPhotoDraft).not.toHaveBeenCalled();
  expect(File).toHaveBeenCalledWith(durableUri);
  expect(jest.mocked(saveDraft).mock.calls[0][0]).toMatchObject({
    id: draft.id,
    receipt: { total_amount: 100 },
  });
});
