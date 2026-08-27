import { expect, test } from '@playwright/test';

test('mouse opening and reverse closing settle on normal Spectrum DOM', async ({ page }) => {
  await page.goto('/?duration=120');
  const card = page.locator('[data-card-trigger]').first();
  await card.click();
  await expect(page.locator('[data-detail-surface]')).toBeVisible();
  await expect(page.locator('[data-detail-heading]')).toBeFocused();
  await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
  await page.locator('[data-close-button]').click();
  await expect(card).toBeFocused();
  await expect(page.locator('[data-detail-surface]')).toBeHidden();
  await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
});
