import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { File } from 'expo-file-system';
import LoadingScreen from '../app/loading';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ photoUri: 'file:///receipt.jpg' }),
  router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true, type: 'wifi' }),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-media-library/legacy', () => ({}));

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
});

test('an inconsistent scan retries the same photo and opens the reconciled receipt', async () => {
  const scan = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(scanResponse(120))
    .mockResolvedValueOnce(scanResponse(100));

  await render(<LoadingScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(scan).toHaveBeenCalledTimes(2);
  expect(jest.mocked(File).mock.calls).toEqual([['file:///receipt.jpg'], ['file:///receipt.jpg']]);
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/receipt-details',
    params: {
      data: JSON.stringify({ ...receipt, receipt_date: '2026-11-16T00:00:00.000Z' }),
      photoUri: 'file:///receipt.jpg',
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
  expect(router.back).toHaveBeenCalledTimes(1);
});
