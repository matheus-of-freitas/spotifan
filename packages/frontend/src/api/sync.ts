export interface SyncStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'paused';
  syncType?: 'quick' | 'full';
  totalArtists: number;
  processedArtists: number;
  errorMessage?: string;
  lastFullSyncAt: number | null;
  resumeAfter?: number;
}

export async function triggerSync(
  syncType: 'quick' | 'full' = 'quick',
  options?: { resume?: boolean },
): Promise<void> {
  const params = new URLSearchParams({ type: syncType });
  if (options?.resume) params.set('resume', 'true');
  const res = await fetch(`/api/sync?${params.toString()}`, { method: 'POST' });
  if (!res.ok) {
    const data: { error?: string } = await res.json();
    throw new Error(data.error ?? 'Failed to start sync');
  }
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch('/api/sync/status');
  if (!res.ok) throw new Error('Failed to fetch sync status');
  return res.json();
}
