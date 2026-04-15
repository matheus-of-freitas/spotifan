import { describe, it, expect, vi } from 'vitest';
import { cn, formatTimeUntil } from '../utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('text-red-500', 'bg-blue-500')).toBe('text-red-500 bg-blue-500');
  });

  it('handles conflicting tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('handles conditional classes', () => {
    const isHidden = false;
    expect(cn('base', isHidden && 'hidden', 'visible')).toBe('base visible');
  });
});

describe('formatTimeUntil', () => {
  it('returns "now" when time has passed', () => {
    expect(formatTimeUntil(Date.now() - 1000)).toBe('now');
  });

  it('returns minutes only when less than 1 hour', () => {
    vi.useFakeTimers({ now: 1000000 });
    expect(formatTimeUntil(1000000 + 30 * 60_000)).toBe('30m');
    vi.useRealTimers();
  });

  it('returns hours and minutes when 1+ hours', () => {
    vi.useFakeTimers({ now: 1000000 });
    expect(formatTimeUntil(1000000 + 90 * 60_000)).toBe('1h 30m');
    vi.useRealTimers();
  });

  it('rounds up partial minutes', () => {
    vi.useFakeTimers({ now: 1000000 });
    // 10 minutes and 1 millisecond → 11m
    expect(formatTimeUntil(1000000 + 10 * 60_000 + 1)).toBe('11m');
    vi.useRealTimers();
  });

  it('returns "now" when exactly at target time', () => {
    vi.useFakeTimers({ now: 1000000 });
    expect(formatTimeUntil(1000000)).toBe('now');
    vi.useRealTimers();
  });
});
