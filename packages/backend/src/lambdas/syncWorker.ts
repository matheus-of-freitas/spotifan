import { runSync } from '../services/syncService.js';

interface SyncEvent {
  spotifyId: string;
  syncType: 'quick' | 'full';
}

export async function handler(event: SyncEvent): Promise<void> {
  console.log('syncWorker invoked for:', event.spotifyId, 'type:', event.syncType);
  await runSync(event.spotifyId, event.syncType);
  console.log('syncWorker completed for:', event.spotifyId);
}
