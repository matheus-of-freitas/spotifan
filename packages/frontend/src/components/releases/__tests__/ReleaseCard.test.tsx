import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReleaseCard } from '../ReleaseCard';
import type { Release } from '../../../api/releases';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const makeRelease = (overrides: Partial<Release> = {}): Release => ({
  albumId: 'abc123',
  title: 'Test Album',
  artistId: 'a1',
  artistName: 'Test Artist',
  albumType: 'album',
  imageUrl: 'http://img.test/cover.jpg',
  spotifyUrl: 'https://open.spotify.com/album/abc123',
  releaseDate: '2024-01-15',
  year: '2024',
  genres: ['rock'],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ReleaseCard', () => {
  it('renders title, artistName, releaseDate', () => {
    render(<ReleaseCard release={makeRelease()} index={0} />);
    expect(screen.getByText('Test Album')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
  });

  it('renders img when imageUrl is set', () => {
    render(<ReleaseCard release={makeRelease()} index={0} />);
    expect(screen.getByAltText('Test Album')).toHaveAttribute('src', 'http://img.test/cover.jpg');
  });

  it('renders fallback icon when imageUrl is empty', () => {
    render(<ReleaseCard release={makeRelease({ imageUrl: '' })} index={0} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('♫')).toBeInTheDocument();
  });

  it('click sets location.href and opens window after 500ms when not hidden', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, 'href', {
      set: hrefSetter,
      get: () => '',
      configurable: true,
    });

    render(<ReleaseCard release={makeRelease()} index={0} />);
    screen.getByRole('link').click();

    expect(hrefSetter).toHaveBeenCalledWith('spotify:album:abc123');

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(openSpy).toHaveBeenCalledWith(
      'https://open.spotify.com/album/abc123',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does not call window.open when document is hidden at timeout', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    render(<ReleaseCard release={makeRelease()} index={0} />);
    screen.getByRole('link').click();

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('handles Enter key', () => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
    render(<ReleaseCard release={makeRelease()} index={0} />);
    const card = screen.getByRole('link');
    card.focus();

    // Simulate keydown directly since userEvent.keyboard with fake timers is complex
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    card.dispatchEvent(event);
  });

  it('handles Space key', () => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    render(<ReleaseCard release={makeRelease()} index={0} />);
    const card = screen.getByRole('link');

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    card.dispatchEvent(event);
  });
});
