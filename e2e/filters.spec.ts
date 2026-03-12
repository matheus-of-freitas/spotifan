import { test, expect, type Page } from '@playwright/test';

const mockUser = {
  spotifyId: 'user123',
  displayName: 'Test User',
  syncStatus: 'idle',
  lastFullSyncAt: Date.now(),
};

async function setupMocks(page: Page) {
  await page.route('/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) }),
  );
  await page.route('/api/releases?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            albumId: 'a1',
            title: 'Album A',
            artistId: 'ar1',
            artistName: 'Artist A',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: 'https://open.spotify.com/album/a1',
            releaseDate: '2024-01-01',
            year: '2024',
            genres: ['rock'],
          },
        ],
        nextCursor: null,
      }),
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
        lastFullSyncAt: Date.now(),
      }),
    }),
  );
}

test.describe('Filters', () => {
  test('year filter selects a year', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');

    const yearSelect = page.locator('select').first();
    await expect(yearSelect).toBeVisible();
    await yearSelect.selectOption('2024');
    await expect(yearSelect).toHaveValue('2024');
  });

  test('date range preset toggles active state', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');

    const preset = page.getByRole('button', { name: 'Last 7 days' });
    await expect(preset).toBeVisible();
    await preset.click();
    // Active preset has green styling (bg-spotify-green)
    await expect(preset).toHaveClass(/bg-spotify-green/);

    // Click again to deactivate
    await preset.click();
    await expect(preset).not.toHaveClass(/bg-spotify-green text-spotify-black/);
  });

  test('search input accepts text', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');

    const searchInput = page.getByPlaceholder('Search releases...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Album A');
    await expect(searchInput).toHaveValue('Album A');
  });

  test('sort dropdown changes sort option', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');

    // Find the sort dropdown (second select — first is year)
    const sortSelect = page.locator('select').nth(1);
    await expect(sortSelect).toBeVisible();
    await sortSelect.selectOption('artist');
    await expect(sortSelect).toHaveValue('artist');
  });
});
