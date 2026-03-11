import { Logger } from '@aws-lambda-powertools/logger';
import type { Context as LambdaContext } from 'aws-lambda';
import type { Context as HonoContext } from 'hono';
import type { HonoEnv } from './honoTypes.js';

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

export const logger = new Logger({
  serviceName: 'spotifan-backend',
});

export function compactLogContext(context: LogContext): Record<string, Exclude<LogValue, undefined>> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Record<string, Exclude<LogValue, undefined>>;
}

export function createChildLogger(context: LogContext = {}): Logger {
  return logger.createChild({
    persistentKeys: compactLogContext(context),
  }) as Logger;
}

export function bindLambdaContext(targetLogger: Logger, context: LambdaContext): Logger {
  targetLogger.addContext(context);
  return targetLogger;
}

export function getContextLogger(c: HonoContext<HonoEnv>): Logger {
  return c.get('logger') ?? logger;
}

export function logUnknownError(
  targetLogger: Logger,
  message: string,
  error: unknown,
  context: LogContext = {},
): void {
  const safeContext = compactLogContext(context);
  if (error instanceof Error) {
    targetLogger.error(message, {
      ...safeContext,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack ?? null,
    });
    return;
  }

  targetLogger.error(message, {
    ...safeContext,
    error: String(error),
  });
}
