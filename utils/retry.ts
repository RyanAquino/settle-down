export async function retryApiCall<T>(
  apiCall: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 5000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Retry failed');
}
