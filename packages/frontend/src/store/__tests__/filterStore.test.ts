import { describe, it, expect, beforeEach } from 'vitest';
import { useFilterStore } from '../filterStore';

beforeEach(() => {
  useFilterStore.setState({
    year: null,
    sort: 'date',
    dateRange: null,
    genres: [],
    search: '',
  });
});

describe('filterStore', () => {
  it('has correct initial state', () => {
    const state = useFilterStore.getState();
    expect(state.year).toBeNull();
    expect(state.sort).toBe('date');
    expect(state.dateRange).toBeNull();
    expect(state.genres).toEqual([]);
    expect(state.search).toBe('');
  });

  it('setYear sets year and clears dateRange', () => {
    useFilterStore.getState().setDateRange('7d');
    useFilterStore.getState().setYear('2024');
    const state = useFilterStore.getState();
    expect(state.year).toBe('2024');
    expect(state.dateRange).toBeNull();
  });

  it('setDateRange sets dateRange and clears year', () => {
    useFilterStore.getState().setYear('2024');
    useFilterStore.getState().setDateRange('7d');
    const state = useFilterStore.getState();
    expect(state.dateRange).toBe('7d');
    expect(state.year).toBeNull();
  });

  it('setSort sets sort', () => {
    useFilterStore.getState().setSort('artist');
    expect(useFilterStore.getState().sort).toBe('artist');
  });

  it('toggleGenre adds genre when absent', () => {
    useFilterStore.getState().toggleGenre('rock');
    expect(useFilterStore.getState().genres).toEqual(['rock']);
  });

  it('toggleGenre removes genre when present', () => {
    useFilterStore.setState({ genres: ['rock', 'pop'] });
    useFilterStore.getState().toggleGenre('rock');
    expect(useFilterStore.getState().genres).toEqual(['pop']);
  });

  it('setGenres replaces array', () => {
    useFilterStore.getState().setGenres(['jazz', 'blues']);
    expect(useFilterStore.getState().genres).toEqual(['jazz', 'blues']);
  });

  it('setSearch sets search', () => {
    useFilterStore.getState().setSearch('test');
    expect(useFilterStore.getState().search).toBe('test');
  });
});
