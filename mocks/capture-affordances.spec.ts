import { expect, test } from '@playwright/test';

/**
 * Captures each pending-affordance candidate for review.
 *
 * Deliberately **not** under `tests/e2e`, so it is never picked up by `test:e2e` or
 * `test:visual` and cannot become a baseline. Run explicitly:
 *
 *   npx playwright test mocks/capture-affordances.spec.ts --project=chromium-desktop
 *
 * Animations are paused at a chosen offset rather than left running, so the two
 * animated candidates are captured at a moment that actually shows the effect instead
 * of whenever the screenshot happened to land.
 */

const OPTIONS = ['dim', 'pulse', 'sweep', 'spinner'] as const;

/** Freezes every running animation at `offsetMs` so a still frame is representative. */
async function freezeAnimationsAt(page: import('@playwright/test').Page, offsetMs: number) {
  await page.evaluate((offset) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = offset;
    }
  }, offsetMs);
}

test.describe('pending affordance candidates', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/mocks/pending-affordance.html');
    // The tiles are Spectrum components; wait for one to have laid out.
    await page.locator('[data-option="dim"] sp-card').first().waitFor();
    await page.waitForTimeout(400);
  });

  for (const option of OPTIONS) {
    test(`captures ${option}`, async ({ page }, testInfo) => {
      // Mid-animation for the animated ones: pulse at its dimmest, sweep mid-travel.
      await freezeAnimationsAt(page, option === 'pulse' ? 450 : 500);

      const section = page.locator(`[data-option="${option}"]`);
      await expect(section).toBeVisible();

      const file = testInfo.outputPath(`${option}.png`);
      await section.screenshot({ path: file });
      // eslint-disable-next-line no-console
      console.log(`AFFORDANCE_SHOT ${option} ${file}`);

      // A close crop of just the pending tile beside an idle one, because the
      // full-row shot is too small to judge a 4px bar or an 18px ring.
      const pair = testInfo.outputPath(`${option}-detail.png`);
      const grid = section.locator('.card-grid');
      const box = await grid.boundingBox();
      if (box) {
        await page.screenshot({
          path: pair,
          clip: { x: box.x, y: box.y, width: Math.min(box.width, 660), height: box.height },
        });
        // eslint-disable-next-line no-console
        console.log(`AFFORDANCE_SHOT ${option}-detail ${pair}`);
      }
    });
  }

  test('captures all four together', async ({ page }, testInfo) => {
    await freezeAnimationsAt(page, 500);
    const file = testInfo.outputPath('all.png');
    await page.screenshot({ path: file, fullPage: true });
    // eslint-disable-next-line no-console
    console.log(`AFFORDANCE_SHOT all ${file}`);
  });
});
