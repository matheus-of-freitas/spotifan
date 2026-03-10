import { create } from 'zustand';

type SortField = 'date' | 'artist' | 'title';

interface FilterState {
  year: string | null;
  sort: SortField;
  setYear: (year: string | null) => void;
  setSort: (sort: SortField) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  year: null,
  sort: 'date',
  setYear: (year) => set({ year }),
  setSort: (sort) => set({ sort }),
}));
