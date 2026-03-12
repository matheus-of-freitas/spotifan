import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

const { OutletMock, ToasterMock } = vi.hoisted(() => ({
  OutletMock: vi.fn(() => React.createElement('div', { 'data-testid': 'outlet' })),
  ToasterMock: vi.fn(() => React.createElement('div', { 'data-testid': 'toaster' })),
}));

vi.mock('@tanstack/react-router', () => ({
  createRootRoute: ({ component }: { component: () => React.ReactNode }) => ({
    component,
  }),
  Outlet: OutletMock,
}));

vi.mock('sonner', () => ({
  Toaster: ToasterMock,
}));

describe('RootLayout', () => {
  it('renders Outlet and Toaster', async () => {
    const mod = await import('../__root');
    const Component = mod.Route.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.getByTestId('toaster')).toBeInTheDocument();
  });
});
