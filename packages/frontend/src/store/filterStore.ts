import { create } from 'zustand';

interface FilterState {
  year: string | null;
  dateRange: string | null;
  setYear: (year: string | null) => void;
  setDateRange: (dateRange: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  year: null,
  dateRange: null,
  setYear: (year) => set({ year, dateRange: null }),
  setDateRange: (dateRange) => set({ dateRange, year: null }),
}));
