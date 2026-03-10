import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../retry.js';
import { TooManyRequestsError, AppError } from '../errors.js';

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
});
