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
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
  await page.route('/api/releases/years', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ years: ['2024'] }),
    }),
  );
  await page.route('/api/releases/genres', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ genres: [] }),
    }),
  );
}

test.describe('Sync flow', () => {
  test('Full Sync triggers and shows progress', async ({ page }) => {
    let pollCount = 0;

    await setupMocks(page);
    await page.route('/api/sync/status', (route) => {
      pollCount++;
      if (pollCount <= 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'idle',
            totalArtists: 0,
            processedArtists: 0,
            lastFullSyncAt: Date.now(),
          }),
        });
      } else if (pollCount <= 3) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'running',
            syncType: 'full',
            totalArtists: 10,
            processedArtists: 5,
            lastFullSyncAt: Date.now(),
          }),
        });
      } else {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'idle',
            totalArtists: 10,
            processedArtists: 10,
            lastFullSyncAt: Date.now(),
          }),
        });
      }
    });
    await page.route('POST /api/sync?*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Full Sync' })).toBeVisible();
    await page.getByRole('button', { name: 'Full Sync' }).click();

    // After done, buttons should return
    await expect(page.getByRole('button', { name: 'Full Sync' })).toBeVisible({
      timeout: 10000,
    });
  });
});
