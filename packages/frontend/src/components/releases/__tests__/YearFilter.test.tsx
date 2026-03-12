import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YearFilter } from '../YearFilter';

const { useQueryMock, useFilterStoreMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useFilterStoreMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../../store/filterStore', () => ({
  useFilterStore: useFilterStoreMock,
}));

const setYearMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  setYearMock.mockReset();
});

describe('YearFilter', () => {
  it('returns null when no years', () => {
    useQueryMock.mockReturnValue({ data: undefined });
    useFilterStoreMock.mockReturnValue({ year: null, setYear: setYearMock });

    const { container } = render(<YearFilter />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when years is empty array', () => {
    useQueryMock.mockReturnValue({ data: [] });
    useFilterStoreMock.mockReturnValue({ year: null, setYear: setYearMock });

    const { container } = render(<YearFilter />);
    expect(container.innerHTML).toBe('');
  });

  it('renders select with "All years" and year options', () => {
    useQueryMock.mockReturnValue({ data: ['2024', '2023'] });
    useFilterStoreMock.mockReturnValue({ year: null, setYear: setYearMock });

    render(<YearFilter />);
    expect(screen.getByText('All years')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
  });

  it('calls setYear with selected value on change', async () => {
    useQueryMock.mockReturnValue({ data: ['2024', '2023'] });
    useFilterStoreMock.mockReturnValue({ year: null, setYear: setYearMock });

    render(<YearFilter />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox'), '2024');
    expect(setYearMock).toHaveBeenCalledWith('2024');
  });

  it('calls setYear with null when "All years" selected', async () => {
    useQueryMock.mockReturnValue({ data: ['2024', '2023'] });
    useFilterStoreMock.mockReturnValue({ year: '2024', setYear: setYearMock });

    render(<YearFilter />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox'), '');
    expect(setYearMock).toHaveBeenCalledWith(null);
  });
});
