import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: { component: React.ComponentType }) => opts,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe('LoginPage', () => {
  it('renders heading, subtitle, and login link', async () => {
    const mod = await import('../login');
    const Component = mod.Route.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText('Spotifan')).toBeInTheDocument();
    expect(screen.getByText('Never miss an album from the artists you follow')).toBeInTheDocument();
    const link = screen.getByText('Log in with Spotify');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/api/auth/login');
  });
});
