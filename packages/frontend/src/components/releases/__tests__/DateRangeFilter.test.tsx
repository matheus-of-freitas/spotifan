import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateRangeFilter } from '../DateRangeFilter';

const { useFilterStoreMock } = vi.hoisted(() => ({
  useFilterStoreMock: vi.fn(),
}));

vi.mock('../../../store/filterStore', () => ({
  useFilterStore: useFilterStoreMock,
}));

const setDateRangeMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DateRangeFilter', () => {
  it('renders 5 preset buttons', () => {
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ dateRange: null, setDateRange: setDateRangeMock }),
    );
    render(<DateRangeFilter />);
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Last 15 days')).toBeInTheDocument();
    expect(screen.getByText('Last month')).toBeInTheDocument();
    expect(screen.getByText('Last 3 months')).toBeInTheDocument();
    expect(screen.getByText('Last 6 months')).toBeInTheDocument();
  });

  it('calls setDateRange with preset value when clicking inactive preset', async () => {
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ dateRange: null, setDateRange: setDateRangeMock }),
    );
    render(<DateRangeFilter />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Last 7 days'));
    expect(setDateRangeMock).toHaveBeenCalledWith('7d');
  });

  it('calls setDateRange(null) when clicking active preset (toggle off)', async () => {
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ dateRange: '7d', setDateRange: setDateRangeMock }),
    );
    render(<DateRangeFilter />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Last 7 days'));
    expect(setDateRangeMock).toHaveBeenCalledWith(null);
  });
});
