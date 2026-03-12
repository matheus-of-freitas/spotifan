import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { useAuthMock, navigateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: { component: React.ComponentType }) => opts,
  useNavigate: () => navigateMock,
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('../../components/releases/YearFilter', () => ({
  YearFilter: () => <div data-testid="year-filter" />,
}));

vi.mock('../../components/releases/SortDropdown', () => ({
  SortDropdown: () => <div data-testid="sort-dropdown" />,
}));

vi.mock('../../components/releases/DateRangeFilter', () => ({
  DateRangeFilter: () => <div data-testid="date-range-filter" />,
}));

vi.mock('../../components/releases/GenreFilter', () => ({
  GenreFilter: () => <div data-testid="genre-filter" />,
}));

vi.mock('../../components/releases/SearchInput', () => ({
  SearchInput: () => <div data-testid="search-input" />,
}));

vi.mock('../../components/releases/ReleaseGrid', () => ({
  ReleaseGrid: () => <div data-testid="release-grid" />,
}));

vi.mock('../../components/sync/SyncProgress', () => ({
  SyncProgress: () => <div data-testid="sync-progress" />,
}));

function renderPage(Component: React.ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigateMock.mockResolvedValue(undefined);
});

describe('HomePage', () => {
  it('shows spinner when loading', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true, isAuthenticated: false });

    const mod = await import('../index');
    const Component = mod.Route.component as React.ComponentType;
    renderPage(Component);

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to /login when not authenticated', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false, isAuthenticated: false });

    const mod = await import('../index');
    const Component = mod.Route.component as React.ComponentType;
    renderPage(Component);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
    });
  });

  it('renders Header and ReleaseGrid when authenticated', async () => {
    useAuthMock.mockReturnValue({
      user: { spotifyId: '123', displayName: 'Test' },
      isLoading: false,
      isAuthenticated: true,
    });

    const mod = await import('../index');
    const Component = mod.Route.component as React.ComponentType;
    renderPage(Component);

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('release-grid')).toBeInTheDocument();
  });

  it('returns null when user is null post-loading', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false, isAuthenticated: true });

    const mod = await import('../index');
    const Component = mod.Route.component as React.ComponentType;
    const { container } = renderPage(Component);

    // user is null so renders null
    expect(container.querySelector('[data-testid="header"]')).not.toBeInTheDocument();
  });
});
