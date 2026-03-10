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

      if (isServerError(err)) {
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
