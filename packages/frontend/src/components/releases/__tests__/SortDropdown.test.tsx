import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SortDropdown } from '../SortDropdown';

const { useFilterStoreMock } = vi.hoisted(() => ({
  useFilterStoreMock: vi.fn(),
}));

vi.mock('../../../store/filterStore', () => ({
  useFilterStore: useFilterStoreMock,
}));

const setSortMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) => {
    const state = { sort: 'date', setSort: setSortMock };
    return selector(state);
  });
});

describe('SortDropdown', () => {
  it('renders all 3 sort options', () => {
    render(<SortDropdown />);
    expect(screen.getByText('Release Date')).toBeInTheDocument();
    expect(screen.getByText('Artist Name')).toBeInTheDocument();
    expect(screen.getByText('Album Title')).toBeInTheDocument();
  });

  it('calls setSort with correct value on change', async () => {
    render(<SortDropdown />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox'), 'artist');
    expect(setSortMock).toHaveBeenCalledWith('artist');
  });
});
