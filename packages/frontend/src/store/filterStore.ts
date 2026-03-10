import { create } from 'zustand';

type SortField = 'date' | 'artist' | 'title';

interface FilterState {
  year: string | null;
  sort: SortField;
  dateRange: string | null;
  genres: string[];
  setYear: (year: string | null) => void;
  setSort: (sort: SortField) => void;
  setDateRange: (dateRange: string | null) => void;
  toggleGenre: (genre: string) => void;
  setGenres: (genres: string[]) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  year: null,
  sort: 'date',
  dateRange: null,
  genres: [],
  setYear: (year) => set({ year, dateRange: null }),
  setSort: (sort) => set({ sort }),
  setDateRange: (dateRange) => set({ dateRange, year: null }),
  toggleGenre: (genre) =>
    set((state) => ({
      genres: state.genres.includes(genre)
        ? state.genres.filter((g) => g !== genre)
        : [...state.genres, genre],
    })),
  setGenres: (genres) => set({ genres }),
}));
