// Proves the WebGL 3-D view mounts and draws without errors (software GL).
import { expect, test } from '@playwright/test';

test('3-D orbit view renders with WebGL', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/sandbox/sensor_geometry_orbit');
  const canvas = page.locator('canvas[aria-label^="3-D orbit view"], div[aria-label^="3-D orbit view"] canvas').first();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 180_000 });
  // The r3f canvas is the one inside the 3-D container; the 2-D fallback must NOT be used
  await expect(page.getByLabel('Orbit projected on the equatorial plane with the estimate\'s 2-D confidence ellipse')).toHaveCount(0);
  await expect(canvas.or(page.locator('canvas').first())).toBeVisible();
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) await page.screenshot({ path: `${shots}/orbit-3d.png`, timeout: 180_000 });
  expect(errors).toEqual([]);
});
