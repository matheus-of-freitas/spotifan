export interface SyncStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  totalArtists: number;
  processedArtists: number;
  errorMessage?: string;
}

export async function triggerSync(): Promise<void> {
  const res = await fetch('/api/sync', { method: 'POST' });
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
