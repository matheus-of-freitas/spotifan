import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../retry.js';
import { TooManyRequestsError, AppError, RetryBudgetExceededError } from '../errors.js';

describe('retry', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on TooManyRequestsError and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TooManyRequestsError(0)).mockResolvedValue('ok');

    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx server error with exponential backoff', async () => {
    const serverError = new AppError(502, 'Bad gateway');
    const fn = vi.fn().mockRejectedValueOnce(serverError).mockResolvedValue('ok');

    const result = await withRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts on rate limit', async () => {
    const error = new TooManyRequestsError(0);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 2)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts on server error', async () => {
    const error = new AppError(500, 'Server error');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 2)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const error = new AppError(400, 'Bad request');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws immediately on generic Error', async () => {
    const error = new Error('Something broke');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on ETIMEDOUT network error', async () => {
    const error = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');

    const result = await withRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on ECONNRESET network error', async () => {
    const error = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');

    const result = await withRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts on network error', async () => {
    const error = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 2)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry unknown error codes', async () => {
    const error = Object.assign(new Error('Unknown'), { code: 'EUNKNOWN' });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws when retry budget would be exceeded by rate limiting', async () => {
    const error = new TooManyRequestsError(2);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        maxElapsedMs: 1000,
        operation: 'Spotify followed artists fetch',
      }),
    ).rejects.toThrow('Spotify followed artists fetch exceeded retry budget');
  });

  it('reports retry metadata through onRetry', async () => {
    const error = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' });
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      onRetry,
    });

    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      cause: 'network_error',
      delayMs: 1000,
      elapsedMs: expect.any(Number),
    });
  });

  it('reports rate-limit retry metadata through onRetry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new TooManyRequestsError(0)).mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      onRetry,
    });

    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      cause: 'rate_limit',
      delayMs: 0,
      elapsedMs: expect.any(Number),
    });
  });

  it('uses default max attempts when retry options omit maxAttempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TooManyRequestsError(0))
      .mockRejectedValueOnce(new TooManyRequestsError(0))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { onRetry: vi.fn() });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reports server-error retry metadata through onRetry', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AppError(503, 'Service unavailable'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      onRetry,
    });

    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      cause: 'server_error',
      delayMs: 1000,
      elapsedMs: expect.any(Number),
    });
  });

  it('uses the default operation label when retry budget is exceeded without an operation', async () => {
    const fn = vi.fn().mockRejectedValue(new TooManyRequestsError(2));

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        maxElapsedMs: 1000,
      }),
    ).rejects.toThrow('Operation exceeded retry budget');
  });

  it('propagates retryAfterSeconds through RetryBudgetExceededError on rate limit', async () => {
    const error = new TooManyRequestsError(86294);
    const fn = vi.fn().mockRejectedValue(error);

    try {
      await withRetry(fn, {
        maxAttempts: 5,
        maxElapsedMs: 1000,
        operation: 'Spotify fetch',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryBudgetExceededError);
      expect((err as RetryBudgetExceededError).retryAfterSeconds).toBe(86294);
    }
  });

  it('allows retries to continue when the retry budget has not been exceeded', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TooManyRequestsError(0)).mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      maxElapsedMs: 5000,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
