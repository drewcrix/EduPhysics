import { expect, test } from '@playwright/test';

test.describe('Airfoil Flow Lab', () => {
  test('loads a computed case and renders the flow, plots and explanations', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./#/simulator?airfoil=0012&re=100&aoa=4');
    await expect(page.getByRole('heading', { name: /NACA 0012 · Re 100 · α 4°/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /Velocity magnitude around the airfoil/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Surface pressure coefficient' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Lift coefficient versus angle of attack' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What the simulation shows' })).toBeVisible();
    await expect(page.getByText(/front stagnation point/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the controls only select computed cases', async ({ page }) => {
    await page.goto('./#/simulator?airfoil=0012&re=100&aoa=4');
    await page.getByRole('radio', { name: /NACA 2412/ }).click();
    await expect(page.getByRole('heading', { name: /NACA 2412/ })).toBeVisible();
    const aoa = page.getByLabel('Angle of attack α');
    await aoa.focus();
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/aoa=-4/);                      // cambered sections include -4°
    await expect(page.getByRole('heading', { name: /α -4°/ })).toBeVisible();
    await page.getByRole('button', { name: 'Pressure coefficient' }).click();
    await expect(page.getByRole('img', { name: /Pressure coefficient around the airfoil/ })).toBeVisible();
  });

  test('theory, high-lift and boundary-condition pages render', async ({ page }) => {
    await page.goto('./#/theory');
    await expect(page.getByRole('heading', { name: /Governing equations/ })).toBeVisible();
    await expect(page.locator('.katex').first()).toBeVisible();
    await page.getByRole('link', { name: 'High-lift devices' }).click();
    await expect(page.getByText('Nothing on this page is a Navier–Stokes result.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Leading-edge slat' }).click();
    await expect(page.getByRole('heading', { name: 'Leading-edge slat' })).toBeVisible();
    await page.getByRole('link', { name: 'Boundary conditions' }).click();
    await expect(page.getByRole('heading', { name: 'Boundary conditions', exact: true })).toBeVisible();
  });
});
