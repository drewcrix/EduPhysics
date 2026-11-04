// Browser smoke test: welcome page, a guided mission (prediction gate → step → play),
// replay determinism across playback speeds, the showdown, and a mobile layout check.
import { expect, test, type Page } from '@playwright/test';

const shots = process.env.SCREENSHOTS_DIR;

async function noConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('welcome page renders with calls to action and the assistant', async ({ page }) => {
  const errors = await noConsoleErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Fly the console/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start guided mission|Continue/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free sandbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Learn estimation' })).toBeVisible();
  await expect(page.getByText('Welcome to Mission Control Academy')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Campaign' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/welcome.png` });
  expect(errors).toEqual([]);
});

test('guided mission: prediction gate, phase stepping and playback', async ({ page }) => {
  const errors = await noConsoleErrors(page);
  await page.goto('/#/mission/first-fix');
  await expect(page.getByText('Loading the C++ simulation core')).toBeHidden({ timeout: 30_000 });
  const play = page.getByRole('button', { name: 'Play' });
  await expect(play).toBeDisabled(); // must predict first
  await page.getByRole('radio', { name: /one position fix says nothing about velocity/ }).click();
  await expect(play).toBeEnabled();
  await page.getByRole('button', { name: /^Predict/ }).click();
  await expect(page.getByText('next: update')).toBeVisible();
  await page.getByRole('button', { name: /^Update/ }).click();
  await expect(page.getByText('next: predict')).toBeVisible();
  await expect(page.getByText('Step through one Predict → Update cycle')).toBeVisible();
  await play.click();
  await page.waitForFunction(() => /t = (0[1-9]|[1-9]\d):/.test(document.body.innerText), undefined, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('tab', { name: 'Uncertainty' }).click();
  await expect(page.getByText('1σ position uncertainty by direction')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/mission-control.png` });
  expect(errors).toEqual([]);
});

test('results are identical at different playback speeds (replay hash)', async ({ page }) => {
  const hashAt = async (speed: string) => {
    await page.goto('/#/sandbox/first_fix');
    await page.reload();
    await expect(page.getByText('Loading the C++ simulation core')).toBeHidden({ timeout: 30_000 });
    await page.getByLabel('Playback speed (simulated seconds per second)').selectOption(speed);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('dialog', { name: /Run summary/ })).toBeVisible({ timeout: 60_000 });
    const hash = await page.getByRole('row', { name: /Replay hash/ }).locator('td').nth(1).innerText();
    return hash.trim();
  };
  const a = await hashAt('1000');
  const b = await hashAt('300');
  expect(a.length).toBeGreaterThan(5);
  expect(a).toBe(b);
});

test('filter showdown runs every estimator on the same seed', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/sandbox/linear_lab_cw');
  await expect(page.getByText('Loading the C++ simulation core')).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Showdown' }).click();
  await page.getByRole('button', { name: 'Run showdown' }).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('cell', { name: 'Particle filter', exact: true })).toBeVisible();
  await expect(page.getByText('Position error (solid) vs claimed 3σ (dashed)')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/showdown.png` });
});

test('mobile layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/#/mission/first-fix', '/#/learn']) {
    await page.goto(path);
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  if (shots) await page.screenshot({ path: `${shots}/mobile-mission.png`, fullPage: false });
});

test('keyboard: Space plays and pauses, focusable controls have visible labels', async ({ page }) => {
  await page.goto('/#/sandbox/first_fix');
  await expect(page.getByText('Loading the C++ simulation core')).toBeHidden({ timeout: 30_000 });
  await page.locator('body').press('Space');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.locator('body').press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent);
  expect(focused).toBeTruthy();
});
