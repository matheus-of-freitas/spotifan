import { runSync } from '../services/syncService.js';

interface SyncEvent {
  spotifyId: string;
}

export async function handler(event: SyncEvent): Promise<void> {
  console.log('syncWorker invoked for:', event.spotifyId);
  await runSync(event.spotifyId);
  console.log('syncWorker completed for:', event.spotifyId);
}
