import { create } from 'zustand';

export interface User {
  spotifyId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  syncStatus: string;
  lastSyncedAt?: number;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));
