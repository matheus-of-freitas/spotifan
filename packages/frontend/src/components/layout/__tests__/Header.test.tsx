import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Header } from '../Header';

const { useAuthMock, logoutMock, useNavigateMock, navigateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  logoutMock: vi.fn(),
  useNavigateMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../api/auth', () => ({
  logout: logoutMock,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: useNavigateMock,
}));

function renderHeader() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Header />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useNavigateMock.mockReturnValue(navigateMock);
  logoutMock.mockResolvedValue(undefined);
  navigateMock.mockResolvedValue(undefined);
});

describe('Header', () => {
  it('renders logo and app name', () => {
    useAuthMock.mockReturnValue({ user: null });
    renderHeader();
    expect(screen.getByText('Spotifan')).toBeInTheDocument();
  });

  it('shows displayName and avatar when user has imageUrl', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'John', imageUrl: 'http://img.test/avatar.jpg' },
    });
    renderHeader();
    expect(screen.getByText('John')).toBeInTheDocument();
    const img = screen.getByAltText('John');
    expect(img).toHaveAttribute('src', 'http://img.test/avatar.jpg');
  });

  it('shows displayName without avatar when imageUrl is not set', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'John' },
    });
    renderHeader();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not render user section when no user', () => {
    useAuthMock.mockReturnValue({ user: null });
    renderHeader();
    expect(screen.queryByText('Log out')).not.toBeInTheDocument();
  });

  it('handles logout click', async () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'John' },
    });
    renderHeader();

    const user = userEvent.setup();
    await user.click(screen.getByText('Log out'));

    expect(logoutMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
  });
});
