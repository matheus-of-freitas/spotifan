import { create } from 'zustand';

interface FilterState {
  year: string | null;
  setYear: (year: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  year: null,
  setYear: (year) => set({ year }),
}));
