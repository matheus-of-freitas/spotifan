import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchInput } from '../SearchInput';

const { useFilterStoreMock } = vi.hoisted(() => ({
  useFilterStoreMock: vi.fn(),
}));

vi.mock('../../../store/filterStore', () => ({
  useFilterStore: useFilterStoreMock,
}));

const setSearchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SearchInput', () => {
  it('debounces 300ms before calling setSearch', () => {
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ search: '', setSearch: setSearchMock }),
    );

    render(<SearchInput />);
    const input = screen.getByPlaceholderText('Search releases...');
    fireEvent.change(input, { target: { value: 'test' } });

    expect(setSearchMock).not.toHaveBeenCalledWith('test');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSearchMock).toHaveBeenCalledWith('test');
  });

  it('resets local input when external search becomes empty', () => {
    let currentSearch = 'old';
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ search: currentSearch, setSearch: setSearchMock }),
    );

    const { rerender } = render(<SearchInput />);
    expect(screen.getByDisplayValue('old')).toBeInTheDocument();

    currentSearch = '';
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ search: currentSearch, setSearch: setSearchMock }),
    );
    rerender(<SearchInput />);
    expect(screen.getByDisplayValue('')).toBeInTheDocument();
  });
});
