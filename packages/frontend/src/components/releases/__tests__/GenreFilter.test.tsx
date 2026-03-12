import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenreFilter } from '../GenreFilter';

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

const toggleGenreMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function setupMocks(genres: string[], selectedGenres: string[] = []) {
  useQueryMock.mockReturnValue({ data: genres });
  useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ genres: selectedGenres, toggleGenre: toggleGenreMock }),
  );
}

describe('GenreFilter', () => {
  it('returns null when genres empty', () => {
    setupMocks([]);
    const { container } = render(<GenreFilter />);
    expect(container.innerHTML).toBe('');
  });

  it('renders toggle button showing count when genres selected', () => {
    setupMocks(['rock', 'pop'], ['rock']);
    render(<GenreFilter />);
    expect(screen.getByText('Genres (1)')).toBeInTheDocument();
  });

  it('renders toggle button without count when no genres selected', () => {
    setupMocks(['rock', 'pop']);
    render(<GenreFilter />);
    expect(screen.getByText('Genres')).toBeInTheDocument();
  });

  it('opens dropdown on click and closes on second click', async () => {
    setupMocks(['rock', 'pop']);
    render(<GenreFilter />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Genres'));
    expect(screen.getByText('rock')).toBeInTheDocument();
    expect(screen.getByText('pop')).toBeInTheDocument();

    await user.click(screen.getByText('Genres'));
    expect(screen.queryByLabelText('rock')).not.toBeInTheDocument();
  });

  it('toggles genre via checkbox', async () => {
    setupMocks(['rock', 'pop']);
    render(<GenreFilter />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Genres'));
    await user.click(screen.getByRole('checkbox', { name: 'rock' }));
    expect(toggleGenreMock).toHaveBeenCalledWith('rock');
  });

  it('closes dropdown on mousedown outside', async () => {
    setupMocks(['rock', 'pop']);
    render(<GenreFilter />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Genres'));
    expect(screen.getByText('rock')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows checked checkboxes for selected genres', async () => {
    setupMocks(['rock', 'pop'], ['rock']);
    render(<GenreFilter />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Genres (1)'));
    expect(screen.getByRole('checkbox', { name: 'rock' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'pop' })).not.toBeChecked();
  });
});
