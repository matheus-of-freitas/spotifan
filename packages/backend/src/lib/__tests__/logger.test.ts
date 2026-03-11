import type { Context } from 'aws-lambda';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bindLambdaContext,
  compactLogContext,
  createChildLogger,
  getContextLogger,
  logUnknownError,
  logger,
} from '../logger.js';

describe('logger helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('removes undefined values from log context', () => {
    expect(
      compactLogContext({
        route: '/api/sync',
        requestId: undefined,
        retryable: false,
      }),
    ).toEqual({
      route: '/api/sync',
      retryable: false,
    });
  });

  it('creates child loggers with persistent keys', () => {
    const child = createChildLogger({
      route: '/api/releases',
      spotifyId: 'user1',
      omitted: undefined,
    });

    expect(child.getPersistentLogAttributes()).toMatchObject({
      route: '/api/releases',
      spotifyId: 'user1',
    });
    expect(child.getPersistentLogAttributes()).not.toHaveProperty('omitted');
  });

  it('adds lambda context to the logger', () => {
    const addContext = vi.spyOn(logger, 'addContext');
    const lambdaContext = { functionName: 'api', awsRequestId: 'req-1' } as Context;

    const result = bindLambdaContext(logger, lambdaContext);

    expect(result).toBe(logger);
    expect(addContext).toHaveBeenCalledWith(lambdaContext);
  });

  it('returns a context logger when present', () => {
    const contextLogger = createChildLogger({ route: '/api/auth/me' });
    const context = {
      get: vi.fn().mockReturnValue(contextLogger),
    };

    expect(getContextLogger(context as never)).toBe(contextLogger);
  });

  it('falls back to the shared logger when context logger is missing', () => {
    const context = {
      get: vi.fn().mockReturnValue(undefined),
    };

    expect(getContextLogger(context as never)).toBe(logger);
  });

  it('logs Error instances with structured error input', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    logUnknownError(logger, 'Operation failed', error, {
      spotifyId: 'user1',
      retryable: undefined,
    });

    expect(errorSpy).toHaveBeenCalledWith('Operation failed', {
      spotifyId: 'user1',
      errorName: 'Error',
      errorMessage: 'boom',
      stack: error.stack,
    });
  });

  it('logs non-Error values by stringifying them', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    logUnknownError(logger, 'Operation failed', { detail: 'boom' }, { spotifyId: 'user1' });

    expect(errorSpy).toHaveBeenCalledWith('Operation failed', {
      spotifyId: 'user1',
      error: '[object Object]',
    });
  });

  it('falls back to a null stack when an Error has no stack', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');
    error.stack = undefined;

    logUnknownError(logger, 'Operation failed', error);

    expect(errorSpy).toHaveBeenCalledWith('Operation failed', {
      errorName: 'Error',
      errorMessage: 'boom',
      stack: null,
    });
  });
});
