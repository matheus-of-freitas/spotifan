import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from '../useAuth';

const { fetchMeMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
}));

vi.mock('../../api/auth', () => ({
  fetchMe: fetchMeMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAuth', () => {
  it('returns user and isAuthenticated on success', async () => {
    const user = { spotifyId: '123', displayName: 'Test', syncStatus: 'idle' };
    fetchMeMock.mockResolvedValue(user);

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toEqual(user);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns null user and isAuthenticated false on error', async () => {
    fetchMeMock.mockRejectedValue(new Error('Not authenticated'));

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('shows loading state initially', () => {
    fetchMeMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
  });
});
