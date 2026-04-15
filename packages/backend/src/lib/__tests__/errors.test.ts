import { describe, it, expect } from 'vitest';
import {
  AppError,
  UnauthorizedError,
  NotFoundError,
  TooManyRequestsError,
  RetryBudgetExceededError,
} from '../errors.js';

describe('errors', () => {
  describe('AppError', () => {
    it('sets statusCode, message, and code', () => {
      const err = new AppError(400, 'Bad request', 'BAD_REQUEST');
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Bad request');
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.name).toBe('AppError');
      expect(err).toBeInstanceOf(Error);
    });

    it('code is optional', () => {
      const err = new AppError(500, 'Internal');
      expect(err.code).toBeUndefined();
    });
  });

  describe('UnauthorizedError', () => {
    it('has 401 status and default message', () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Unauthorized');
      expect(err.code).toBe('UNAUTHORIZED');
    });

    it('accepts custom message', () => {
      const err = new UnauthorizedError('Token expired');
      expect(err.message).toBe('Token expired');
    });
  });

  describe('NotFoundError', () => {
    it('has 404 status and default message', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err.code).toBe('NOT_FOUND');
    });
  });

  describe('TooManyRequestsError', () => {
    it('has 429 status and retryAfter', () => {
      const err = new TooManyRequestsError(30);
      expect(err.statusCode).toBe(429);
      expect(err.retryAfter).toBe(30);
      expect(err.code).toBe('RATE_LIMITED');
    });
  });

  describe('RetryBudgetExceededError', () => {
    it('has 504 status and message', () => {
      const err = new RetryBudgetExceededError('Operation exceeded retry budget');
      expect(err.statusCode).toBe(504);
      expect(err.message).toBe('Operation exceeded retry budget');
      expect(err.code).toBe('RETRY_BUDGET_EXCEEDED');
      expect(err.retryAfterSeconds).toBeUndefined();
    });

    it('carries retryAfterSeconds when provided', () => {
      const err = new RetryBudgetExceededError('budget exceeded', 86294);
      expect(err.retryAfterSeconds).toBe(86294);
    });
  });
});
