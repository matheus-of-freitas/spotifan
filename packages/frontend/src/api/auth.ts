export interface User {
  spotifyId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  syncStatus: string;
  lastQuickSyncAt?: number;
  lastFullSyncAt?: number;
}

export async function fetchMe(): Promise<User> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) throw new Error('Not authenticated');
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
