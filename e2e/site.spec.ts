import { expect, test } from '@playwright/test';

test('portal links to every simulator and the simulators load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Learn the physics/ })).toBeVisible();

  await page.getByRole('link', { name: 'Open Airfoil Flow Lab' }).click();
  await expect(page).toHaveURL(/\/fluids\//);
  await expect(page.getByRole('heading', { name: /NACA .* · Re .* · α/ })).toBeVisible();
  await page.getByRole('link', { name: 'EduPhysics home' }).click();
  await expect(page).toHaveURL(/localhost:4180\/(index\.html)?$/);

  await page.getByRole('link', { name: 'Open Mission Control Academy' }).click();
  await expect(page).toHaveURL(/\/orbital\//);
  await expect(page.getByText('Mission Control Academy').first()).toBeVisible();
});
