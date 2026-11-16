import { retryApiCall } from '../utils/retry';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('retries transient failures with backoff and returns the successful result', async () => {
  const call = jest
    .fn(() => Promise.resolve('ok'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('ok');
  const result = retryApiCall(call);
  expect(call).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(999);
  expect(call).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(call).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(2000);
  await expect(result).resolves.toBe('ok');
  expect(call).toHaveBeenCalledTimes(3);
});

test('stops after the attempt limit and preserves the final failure', async () => {
  const error = new Error('offline');
  const call = jest.fn(() => Promise.reject(error)).mockRejectedValue(error);
  const assertion = expect(retryApiCall(call)).rejects.toBe(error);
  await jest.runAllTimersAsync();
  await assertion;
  expect(call).toHaveBeenCalledTimes(3);
});
