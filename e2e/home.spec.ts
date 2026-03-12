import { test, expect, type Page } from '@playwright/test';

const mockUser = {
  spotifyId: 'user123',
  displayName: 'Test User',
  email: 'test@example.com',
  imageUrl: 'https://placehold.co/32',
  syncStatus: 'idle',
  lastFullSyncAt: null,
};

const mockReleases = {
  items: [
    {
      albumId: 'album1',
      title: 'Test Album One',
      artistId: 'artist1',
      artistName: 'Artist One',
      albumType: 'album',
      imageUrl: 'https://placehold.co/200',
      spotifyUrl: 'https://open.spotify.com/album/album1',
      releaseDate: '2024-06-01',
      year: '2024',
      genres: ['rock'],
    },
    {
      albumId: 'album2',
      title: 'Test Album Two',
      artistId: 'artist2',
      artistName: 'Artist Two',
      albumType: 'album',
      imageUrl: 'https://placehold.co/200',
      spotifyUrl: 'https://open.spotify.com/album/album2',
      releaseDate: '2024-05-15',
      year: '2024',
      genres: ['pop'],
    },
  ],
  nextCursor: null,
};

async function setupMocks(page: Page) {
  await page.route('/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) }),
  );
  await page.route('/api/releases?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockReleases),
    }),
  );
  await page.route('/api/releases/years', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ years: ['2024', '2023'] }),
    }),
  );
  await page.route('/api/releases/genres', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ genres: ['rock', 'pop'] }),
    }),
  );
  await page.route('/api/sync/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'idle',
        totalArtists: 0,
        processedArtists: 0,
        lastFullSyncAt: null,
      }),
    }),
  );
}

test.describe('Home page', () => {
  test('shows header, releases, and Full Sync button', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');

    await expect(page.getByText('Test User')).toBeVisible();
    await expect(page.getByText('Test Album One')).toBeVisible();
    await expect(page.getByText('Test Album Two')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Full Sync' })).toBeVisible();
  });
});
