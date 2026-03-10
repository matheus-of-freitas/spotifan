import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncProgress } from './SyncProgress';

const { fetchSyncStatusMock, triggerSyncMock } = vi.hoisted(() => ({
  fetchSyncStatusMock: vi.fn(),
  triggerSyncMock: vi.fn(),
}));

vi.mock('../../api/sync', () => ({
  fetchSyncStatus: fetchSyncStatusMock,
  triggerSync: triggerSyncMock,
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

function renderSyncProgress(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncProgress />
    </QueryClientProvider>,
  );
}

describe('SyncProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerSyncMock.mockResolvedValue(undefined);
  });

  it('shows polling errors instead of leaving stale running progress visible', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    queryClient.setQueryData(['sync', 'status'], {
      status: 'running',
      totalArtists: 10,
      processedArtists: 3,
    });
    fetchSyncStatusMock.mockRejectedValue(new Error('Failed to fetch sync status'));

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch sync status')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Quick Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    expect(screen.queryByText('3/10')).not.toBeInTheDocument();
  });

  it('renders backend sync failures returned by the status endpoint', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    fetchSyncStatusMock.mockResolvedValue({
      status: 'error',
      totalArtists: 10,
      processedArtists: 3,
      errorMessage: 'Sync timed out',
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Sync failed: Sync timed out')).toBeInTheDocument();
    });
  });
});
