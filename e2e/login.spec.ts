import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test('redirects unauthenticated user to /login', async ({ page }) => {
    await page.route('/api/auth/me', (route) =>
      route.fulfill({ status: 401, body: 'Unauthorized' }),
    );

    await page.goto('/');
    await page.waitForURL('**/login');

    await expect(page.getByRole('heading', { name: 'Spotifan' })).toBeVisible();
    const loginLink = page.getByRole('link', { name: 'Log in with Spotify' });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/api/auth/login');
  });
});
