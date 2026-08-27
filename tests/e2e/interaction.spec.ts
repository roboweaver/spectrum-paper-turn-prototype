import { expect, test, type Page } from '@playwright/test';

type PaperTurnPageWindow = Window & {
  __paperTurn?: {
    profile: {
      durationMs: number;
    };
  };
};

function cardTrigger(page: Page, index: number) {
  return page.locator('[data-card-trigger]').nth(index);
}

function closeButton(page: Page) {
  return page.locator('[data-close-button]');
}

function detailHeading(page: Page) {
  return page.locator('[data-detail-heading]');
}

function detailSurface(page: Page) {
  return page.locator('[data-detail-surface]');
}

function listSurface(page: Page) {
  return page.locator('[data-list-surface]');
}

function overlay(page: Page) {
  return page.locator('.paper-turn-overlay');
}

function root(page: Page) {
  return page.locator('#app');
}

async function overlayProgress(page: Page) {
  const progressText = await overlay(page).getAttribute('data-progress');
  return progressText === null ? Number.NaN : Number(progressText);
}

async function openCardAndExpectHeading(page: Page, index: number, title: string) {
  await cardTrigger(page, index).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText(title);
  await expect(detailHeading(page)).toBeFocused();
}

async function closeDetailAndExpectFocus(page: Page, index: number) {
  await closeButton(page).click();
  await expect(cardTrigger(page, index)).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
}

async function setDurationMs(page: Page, durationMs: number) {
  await page.evaluate((nextDurationMs) => {
    const paperTurnWindow = window as PaperTurnPageWindow;
    if (!paperTurnWindow.__paperTurn) {
      throw new Error('Expected window.__paperTurn to be available');
    }

    paperTurnWindow.__paperTurn.profile.durationMs = nextDurationMs;
  }, durationMs);
}

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

test('keyboard opening and closing restores focus to the second card', async ({ page }) => {
  await page.goto('/?duration=120');

  const secondCard = cardTrigger(page, 1);
  await secondCard.focus();
  await expect(secondCard).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Workflow patterns');
  await expect(detailHeading(page)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(secondCard).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
});

test('touch opening reveals the third card detail on mobile projects', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only touch coverage');

  await page.goto('/?duration=120');
  await cardTrigger(page, 2).tap();

  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Content surfaces');
  await expect(detailSurface(page)).toHaveJSProperty('inert', false);
});

test('Escape cancels an opening turn and returns the root to idle', async ({ page }) => {
  await page.goto('/?duration=2000');

  await cardTrigger(page, 0).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toBeVisible();
  await expect(listSurface(page)).toHaveJSProperty('inert', true);
  await expect(detailSurface(page)).toHaveJSProperty('inert', true);

  await page.keyboard.press('Escape');

  await expect(detailSurface(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);
});

test('Escape during closing settles at the nearest open endpoint', async ({ page }) => {
  await page.goto('/?duration=120');

  await openCardAndExpectHeading(page, 0, 'Spectrum foundations');
  await setDurationMs(page, 2000);

  await closeButton(page).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toBeVisible();
  await page.waitForFunction(() => {
    const progress = Number(document.querySelector('.paper-turn-overlay')?.getAttribute('data-progress'));
    return Number.isFinite(progress) && progress > 0.5 && progress < 0.95;
  }, { timeout: 1500 });
  const closingProgress = await overlayProgress(page);
  expect(closingProgress).toBeGreaterThan(0.5);
  expect(closingProgress).toBeLessThan(0.95);

  await page.keyboard.press('Escape');

  await expect(detailSurface(page)).toBeVisible();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'open');
  await expect(overlay(page)).toHaveCount(0);
  await expect(detailHeading(page)).toBeFocused();
});

test('resizing mid-motion settles directly to the open detail surface', async ({ page }) => {
  await page.goto('/?duration=10000');

  await cardTrigger(page, 0).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toBeVisible();

  await page.setViewportSize({ width: 900, height: 640 });

  await Promise.all([
    expect(detailSurface(page)).toBeVisible({ timeout: 2000 }),
    expect(root(page)).toHaveAttribute('data-transition-state', 'open', { timeout: 2000 }),
    expect(overlay(page)).toHaveCount(0, { timeout: 2000 }),
  ]);
});

test('each card opens its own content and restores focus when closed', async ({ page }) => {
  await page.goto('/?duration=120');

  for (const [index, title] of ['Spectrum foundations', 'Workflow patterns', 'Content surfaces'].entries()) {
    await openCardAndExpectHeading(page, index, title);
    await closeDetailAndExpectFocus(page, index);
  }
});

test('reduced motion and explicit fallback both skip the mesh overlay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?duration=2000');

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?fallback=1');
  await cardTrigger(page, 1).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Workflow patterns');
  await expect(overlay(page)).toHaveCount(0);
});

test('chromium mobile keeps mesh density and canvas DPR within bounds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'chromium mobile only');

  await page.goto('/?duration=2000');

  await cardTrigger(page, 0).tap();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toBeVisible();

  const metrics = await page.evaluate(() => {
    const overlayElement = document.querySelector<HTMLElement>('.paper-turn-overlay');
    const canvas = overlayElement?.querySelector<HTMLCanvasElement>('canvas');

    if (!overlayElement || !canvas) {
      throw new Error('Expected overlay canvas to exist while the mesh is visible');
    }

    return {
      meshVertices: overlayElement.dataset.meshVertices,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.meshVertices).toBe('315');
  expect(metrics.canvasWidth).toBeLessThanOrEqual(metrics.viewportWidth * 2);
  expect(metrics.canvasHeight).toBeLessThanOrEqual(metrics.viewportHeight * 2);
});
