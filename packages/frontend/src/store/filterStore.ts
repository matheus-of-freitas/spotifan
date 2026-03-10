import { create } from 'zustand';

type SortField = 'date' | 'artist' | 'title';

interface FilterState {
  year: string | null;
  sort: SortField;
  dateRange: string | null;
  setYear: (year: string | null) => void;
  setSort: (sort: SortField) => void;
  setDateRange: (dateRange: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  year: null,
  sort: 'date',
  dateRange: null,
  setYear: (year) => set({ year, dateRange: null }),
  setSort: (sort) => set({ sort }),
  setDateRange: (dateRange) => set({ dateRange, year: null }),
}));
