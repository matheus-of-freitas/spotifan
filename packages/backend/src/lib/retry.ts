import { RetryBudgetExceededError, TooManyRequestsError } from './errors.js';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryContext {
  attempt: number;
  cause: 'rate_limit' | 'server_error' | 'network_error';
  delayMs: number;
  elapsedMs: number;
}

interface RetryOptions {
  maxAttempts?: number;
  maxElapsedMs?: number;
  operation?: string;
  onRetry?: (context: RetryContext) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: number | RetryOptions = 5,
): Promise<T> {
  const retryOptions = typeof options === 'number' ? { maxAttempts: options } : options;
  const maxAttempts = retryOptions.maxAttempts ?? 5;
  const startedAt = Date.now();
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      if (attempt >= maxAttempts) throw err;

      if (err instanceof TooManyRequestsError) {
        const jitter = Math.random() * 1000;
        const delayMs = err.retryAfter * 1000 + jitter;
        const elapsedMs = Date.now() - startedAt;
        throwIfRetryBudgetExceeded(retryOptions, delayMs, elapsedMs);
        retryOptions.onRetry?.({
          attempt,
          cause: 'rate_limit',
          delayMs,
          elapsedMs,
        });
        await sleep(delayMs);
        continue;
      }

      if (isServerError(err) || isNetworkError(err)) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 32000);
        const elapsedMs = Date.now() - startedAt;
        throwIfRetryBudgetExceeded(retryOptions, delayMs, elapsedMs);
        retryOptions.onRetry?.({
          attempt,
          cause: isServerError(err) ? 'server_error' : 'network_error',
          delayMs,
          elapsedMs,
        });
        await sleep(delayMs);
        continue;
      }

      throw err;
    }
  }
}

function throwIfRetryBudgetExceeded(
  options: RetryOptions,
  nextDelayMs: number,
  elapsedMs: number,
): void {
  if (options.maxElapsedMs === undefined) return;
  if (elapsedMs + nextDelayMs <= options.maxElapsedMs) return;

  const operation = options.operation ?? 'Operation';
  throw new RetryBudgetExceededError(`${operation} exceeded retry budget`);
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
