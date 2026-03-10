export interface SyncStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  syncType?: 'quick' | 'full';
  totalArtists: number;
  processedArtists: number;
  errorMessage?: string;
}

export async function triggerSync(syncType: 'quick' | 'full' = 'quick'): Promise<void> {
  const res = await fetch(`/api/sync?type=${syncType}`, { method: 'POST' });
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
