import { TooManyRequestsError } from './errors.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      if (attempt >= maxAttempts) throw err;

      if (err instanceof TooManyRequestsError) {
        const jitter = Math.random() * 1000;
        await sleep(err.retryAfter * 1000 + jitter);
        continue;
      }

      if (isServerError(err) || isNetworkError(err)) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 32000);
        await sleep(backoff);
        continue;
      }

      throw err;
    }
  }
}

function isServerError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number' &&
    (err as { statusCode: number }).statusCode >= 500
  );
}

const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ERR_GOT_REQUEST_ERROR',
]);

function isNetworkError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    NETWORK_ERROR_CODES.has((err as { code: string }).code)
  );
}
