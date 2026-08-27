import { expect, test, type Page } from '@playwright/test';

const TRANSITION_DURATION_MS = 2400;
const STARTUP_TICK_MS = 1;
const STARTUP_TIMEOUT_MS = 500;
const PEAK_CURL_ELAPSED_MS = 1200;
const DIAGONAL_MIDPOINT_ELAPSED_MS = 1488;

const FULL_PAGE_SCREENSHOT = {
  animations: 'disabled',
  caret: 'hide',
  fullPage: true,
  scale: 'css',
} as const;

function overlay(page: Page) {
  return page.locator('.paper-turn-overlay');
}

function root(page: Page) {
  return page.locator('#app');
}

async function readOverlayProgress(page: Page): Promise<number | null> {
  const value = await page.evaluate(() => {
    const overlayElement = document.querySelector<HTMLElement>('.paper-turn-overlay');
    return overlayElement?.dataset.progress ?? null;
  });
  if (value === null) {
    return null;
  }

  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    throw new Error(`Expected a finite overlay progress value, received ${value}`);
  }

  return progress;
}

async function advanceClockUntilOverlayStarts(page: Page): Promise<void> {
  for (let elapsedMs = 0; elapsedMs <= STARTUP_TIMEOUT_MS; elapsedMs += STARTUP_TICK_MS) {
    await page.clock.runFor(STARTUP_TICK_MS);
    const progress = await readOverlayProgress(page);

    if (progress !== null) {
      await expect(overlay(page)).toBeVisible();
      expect(progress).toBe(0);
      return;
    }
  }

  throw new Error(`Overlay never reached a deterministic start frame within ${STARTUP_TIMEOUT_MS}ms`);
}

async function expectOverlayProgressInRange(
  page: Page,
  expectedRange: { min: number; max: number },
  label: string,
): Promise<void> {
  const progress = await readOverlayProgress(page);

  expect(progress, `${label} should keep the overlay mounted`).not.toBeNull();
  expect(progress!).toBeGreaterThanOrEqual(expectedRange.min);
  expect(progress!).toBeLessThanOrEqual(expectedRange.max);
}

test.describe('paper-turn visual checkpoints', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('captures deterministic paper-turn checkpoints', async ({ page }, testInfo) => {
    const isSupportedVisualBaseline =
      testInfo.project.name === 'chromium-desktop' && process.platform === 'darwin';
    test.skip(
      !isSupportedVisualBaseline,
      `Visual baselines are committed only for project "chromium-desktop" on Darwin (current: ${testInfo.project.name} on ${process.platform}).`,
    );

    await page.clock.install();
    await page.goto(`/?duration=${TRANSITION_DURATION_MS}`);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);

    const firstCard = page.locator('[data-card-trigger]').first();
    await expect(firstCard).toBeVisible();

    await firstCard.click();
    await advanceClockUntilOverlayStarts(page);
    await expect(page).toHaveScreenshot('paper-turn-start.png', FULL_PAGE_SCREENSHOT);

    await page.clock.runFor(PEAK_CURL_ELAPSED_MS);
    await expectOverlayProgressInRange(page, { min: 0.46, max: 0.54 }, 'Peak curl checkpoint');
    await expect(page).toHaveScreenshot('paper-turn-peak-curl.png', FULL_PAGE_SCREENSHOT);

    await page.clock.runFor(DIAGONAL_MIDPOINT_ELAPSED_MS - PEAK_CURL_ELAPSED_MS);
    await expectOverlayProgressInRange(page, { min: 0.58, max: 0.66 }, 'Diagonal midpoint checkpoint');
    await expect(page).toHaveScreenshot('paper-turn-diagonal-midpoint.png', FULL_PAGE_SCREENSHOT);

    await page.clock.runFor(TRANSITION_DURATION_MS - DIAGONAL_MIDPOINT_ELAPSED_MS);
    await expect(root(page)).toHaveAttribute('data-transition-state', 'open');
    await expect(overlay(page)).toHaveCount(0);
    await expect(page).toHaveScreenshot('paper-turn-settled.png', FULL_PAGE_SCREENSHOT);
  });
});
