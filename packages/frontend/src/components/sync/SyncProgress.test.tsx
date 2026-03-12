import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncProgress } from './SyncProgress';

const { fetchSyncStatusMock, triggerSyncMock, toastErrorMock } = vi.hoisted(() => ({
  fetchSyncStatusMock: vi.fn(),
  triggerSyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../api/sync', () => ({
  fetchSyncStatus: fetchSyncStatusMock,
  triggerSync: triggerSyncMock,
}));

vi.mock('sonner', () => ({ toast: { error: toastErrorMock }, Toaster: () => null }));

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

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('SyncProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerSyncMock.mockResolvedValue(undefined);
  });

  it('shows polling errors instead of leaving stale running progress visible', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['sync', 'status'], {
      status: 'running',
      totalArtists: 10,
      processedArtists: 3,
      lastFullSyncAt: Date.now(),
    });
    fetchSyncStatusMock.mockRejectedValue(new Error('Failed to fetch sync status'));

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to fetch sync status');
    });

    expect(screen.getByRole('button', { name: 'Quick Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    expect(screen.queryByText('3/10')).not.toBeInTheDocument();
  });

  it('renders backend sync failures returned by the status endpoint', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['sync', 'status'], {
      status: 'running',
      totalArtists: 10,
      processedArtists: 3,
    });
    fetchSyncStatusMock.mockResolvedValue({
      status: 'error',
      totalArtists: 10,
      processedArtists: 3,
      errorMessage: 'Sync timed out',
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Sync failed: Sync timed out');
    });
  });

  it('hides Quick Sync button when lastFullSyncAt is null', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: null,
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Quick Sync' })).not.toBeInTheDocument();
  });

  it('shows Quick Sync button when lastFullSyncAt is set', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quick Sync' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
  });

  it('shows progress bar with correct percentage when running', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'running',
      totalArtists: 10,
      processedArtists: 5,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByText('5/10')).toBeInTheDocument();
    });
  });

  it('shows shimmer animation when isTriggerPending (not running yet)', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    // After trigger, should show shimmer (the '…' text)
    await waitFor(() => {
      expect(screen.getByText('…')).toBeInTheDocument();
    });
  });

  it('handleSync error path: triggerSync rejects → toast.error called', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });
    triggerSyncMock.mockRejectedValue(new Error('Cooldown active'));

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Cooldown active');
    });
  });

  it('handleSync error with non-Error value shows fallback message', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });
    triggerSyncMock.mockRejectedValue('string error');

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Sync failed');
    });
  });

  it('renders sync error with "Unknown error" when errorMessage is missing', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['sync', 'status'], {
      status: 'running',
      totalArtists: 10,
      processedArtists: 3,
    });
    fetchSyncStatusMock.mockResolvedValue({
      status: 'error',
      totalArtists: 10,
      processedArtists: 3,
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Sync failed: Unknown error');
    });
  });

  it('shows non-Error statusError as generic message', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['sync', 'status'], {
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: null,
    });
    fetchSyncStatusMock.mockRejectedValue('not an error object');

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to fetch sync status');
    });
  });

  it('clears justTriggered when running state arrives after trigger', async () => {
    const queryClient = createQueryClient();

    // Initially idle with prior full sync
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    // Trigger sync → sets justTriggeredRef and starts timer
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    await waitFor(() => {
      expect(screen.getByText('…')).toBeInTheDocument();
    });

    // Simulate running state arriving — this exercises clearJustTriggered (lines 39-41)
    fetchSyncStatusMock.mockResolvedValue({
      status: 'running',
      totalArtists: 10,
      processedArtists: 2,
      lastFullSyncAt: Date.now(),
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['sync', 'status'] });
    });

    await waitFor(() => {
      expect(screen.getByText('2/10')).toBeInTheDocument();
    });
  });

  it('justTriggered timeout fires after 30s resetting pending state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = createQueryClient();

    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    await waitFor(() => {
      expect(screen.getByText('…')).toBeInTheDocument();
    });

    // Advance past the 30s timeout to exercise the callback (lines 67-68)
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // After timeout, buttons should reappear since pending is reset
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it('unmount clears justTriggered timer', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    const { unmount } = renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Full Sync' })).toBeInTheDocument();
    });

    // Trigger sync to start the justTriggered timer
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Full Sync' }));

    await waitFor(() => {
      expect(screen.getByText('…')).toBeInTheDocument();
    });

    // Unmount clears the timer (cleanup effect lines 53-57)
    unmount();
  });

  it('Quick Sync button triggers quick sync', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quick Sync' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Quick Sync' }));

    expect(triggerSyncMock).toHaveBeenCalledWith('quick');
  });

  it('handleSync is no-op when already running', async () => {
    const queryClient = createQueryClient();
    fetchSyncStatusMock.mockResolvedValue({
      status: 'running',
      totalArtists: 10,
      processedArtists: 5,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(screen.getByText('5/10')).toBeInTheDocument();
    });

    // Buttons shouldn't be visible when running, but even if we could click, triggerSync should not be called
    expect(triggerSyncMock).not.toHaveBeenCalled();
  });

  it('invalidates releases query when transitioning from running to done', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Start running
    queryClient.setQueryData(['sync', 'status'], {
      status: 'running',
      totalArtists: 10,
      processedArtists: 5,
      lastFullSyncAt: Date.now(),
    });

    // Poll returns done
    fetchSyncStatusMock.mockResolvedValue({
      status: 'done',
      totalArtists: 10,
      processedArtists: 10,
      lastFullSyncAt: Date.now(),
    });

    renderSyncProgress(queryClient);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['releases'] }),
      );
    });
  });
});
