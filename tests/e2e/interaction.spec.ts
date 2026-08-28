import { expect, test, type Page } from '@playwright/test';

type PaperTurnPageWindow = Window & {
  __paperTurn?: {
    profile: {
      durationMs: number;
      fallbackDurationMs: number;
    };
  };
};

const FULL_CLIP = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
const CLOSED_TOP_RIGHT_CLIP = 'polygon(100% 0%, 100% 0%, 100% 0%)';

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

async function detailInlineClip(page: Page) {
  return detailSurface(page).evaluate((element) => (element as HTMLElement).style.clipPath);
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

async function setFallbackDurationMs(page: Page, durationMs: number) {
  await page.evaluate((nextDurationMs) => {
    const paperTurnWindow = window as PaperTurnPageWindow;
    if (!paperTurnWindow.__paperTurn) {
      throw new Error('Expected window.__paperTurn to be available');
    }

    paperTurnWindow.__paperTurn.profile.fallbackDurationMs = nextDurationMs;
  }, durationMs);
}

async function fallbackAnimationSnapshot(page: Page) {
  return detailSurface(page).evaluate((element) => {
    const animation = element.getAnimations()[0] ?? null;
    const effect = animation?.effect;
    const duration = effect ? Number(effect.getTiming().duration) : Number.NaN;
    return {
      animationCount: element.getAnimations().length,
      currentTime: typeof animation?.currentTime === 'number' ? animation.currentTime : Number.NaN,
      progress:
        typeof animation?.currentTime === 'number' && Number.isFinite(duration) && duration > 0
          ? Number(animation.currentTime) / duration
          : Number.NaN,
      playState: animation?.playState ?? 'idle',
      opacity: Number(getComputedStyle(element).opacity),
    };
  });
}

async function waitForFallbackPastMidpoint(page: Page, direction: 'open' | 'close') {
  await page.waitForFunction(
    (expectedDirection) => {
      const detail = document.querySelector<HTMLElement>('[data-detail-surface]');
      const animation = detail?.getAnimations()[0];
      const opacity = detail ? Number(getComputedStyle(detail).opacity) : Number.NaN;
      const effect = animation?.effect;
      const duration = effect ? Number(effect.getTiming().duration) : Number.NaN;
      const progress =
        animation && typeof animation.currentTime === 'number' && Number.isFinite(duration) && duration > 0
          ? Number(animation.currentTime) / duration
          : Number.NaN;

      if (!animation || animation.playState !== 'running' || !Number.isFinite(progress)) {
        return false;
      }

      if (progress <= 0.55 || progress >= 0.95) {
        return false;
      }

      return expectedDirection === 'open' ? opacity > 0.7 && opacity < 1 : opacity > 0 && opacity < 0.4;
    },
    direction,
    { timeout: 8_000 },
  );
}

async function fullMotionDetailSnapshot(page: Page) {
  return detailSurface(page).evaluate((element) => {
    const detailElement = element as HTMLElement;
    const style = getComputedStyle(detailElement);
    return {
      animationCount: detailElement.getAnimations().length,
      hidden: detailElement.hidden,
      inert: detailElement.inert,
      opacity: Number(style.opacity),
      transform: style.transform,
      visibility: style.visibility,
    };
  });
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

test('reduced motion and explicit fallback reset the hidden detail clip before reopen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?duration=2000');

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Spectrum foundations');
  await expect(overlay(page)).toHaveCount(0);
  await closeButton(page).click();
  await expect(cardTrigger(page, 0)).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(CLOSED_TOP_RIGHT_CLIP);

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Spectrum foundations');
  await expect(root(page)).toHaveAttribute('data-transition-state', 'open');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(FULL_CLIP);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?fallback=1');
  await cardTrigger(page, 1).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Workflow patterns');
  await expect(overlay(page)).toHaveCount(0);
  await closeButton(page).click();
  await expect(cardTrigger(page, 1)).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(CLOSED_TOP_RIGHT_CLIP);

  await cardTrigger(page, 1).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Workflow patterns');
  await expect(root(page)).toHaveAttribute('data-transition-state', 'open');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(FULL_CLIP);
});

test('Escape late in explicit fallback open settles open and late close settles idle', async ({ page }) => {
  await page.goto('/?fallback=1&duration=10000');
  await setFallbackDurationMs(page, 10_000);

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await waitForFallbackPastMidpoint(page, 'open');

  const openingAnimation = await fallbackAnimationSnapshot(page);
  expect(openingAnimation.animationCount).toBeGreaterThan(0);
  expect(openingAnimation.playState).toBe('running');
  expect(openingAnimation.progress).toBeGreaterThan(0.55);
  expect(openingAnimation.progress).toBeLessThan(0.95);
  expect(openingAnimation.opacity).toBeGreaterThan(0.7);
  expect(openingAnimation.opacity).toBeLessThan(1);

  await page.keyboard.press('Escape');

  await Promise.all([
    expect(root(page)).toHaveAttribute('data-transition-state', 'open', { timeout: 1_800 }),
    expect(detailHeading(page)).toBeFocused({ timeout: 1_800 }),
    expect(overlay(page)).toHaveCount(0, { timeout: 1_800 }),
    expect.poll(() => detailInlineClip(page), { timeout: 1_800 }).toBe(FULL_CLIP),
    expect
      .poll(async () => (await fallbackAnimationSnapshot(page)).animationCount, { timeout: 1_800 })
      .toBe(0),
  ]);

  await closeButton(page).click();
  await waitForFallbackPastMidpoint(page, 'close');

  const closingAnimation = await fallbackAnimationSnapshot(page);
  expect(closingAnimation.animationCount).toBeGreaterThan(0);
  expect(closingAnimation.playState).toBe('running');
  expect(closingAnimation.progress).toBeGreaterThan(0.55);
  expect(closingAnimation.progress).toBeLessThan(0.95);
  expect(closingAnimation.opacity).toBeGreaterThan(0);
  expect(closingAnimation.opacity).toBeLessThan(0.4);

  await page.keyboard.press('Escape');

  await Promise.all([
    expect(root(page)).toHaveAttribute('data-transition-state', 'idle', { timeout: 1_800 }),
    expect(cardTrigger(page, 0)).toBeFocused({ timeout: 1_800 }),
    expect(detailSurface(page)).toBeHidden({ timeout: 1_800 }),
    expect(overlay(page)).toHaveCount(0, { timeout: 1_800 }),
    expect.poll(() => detailInlineClip(page), { timeout: 1_800 }).toBe(CLOSED_TOP_RIGHT_CLIP),
    expect
      .poll(async () => (await fallbackAnimationSnapshot(page)).animationCount, { timeout: 1_800 })
      .toBe(0),
  ]);
});

test('mixed fallback close cleanup does not poison the next full-motion reopen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?duration=120');

  await openCardAndExpectHeading(page, 0, 'Spectrum foundations');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setFallbackDurationMs(page, 3_000);
  await closeButton(page).click();
  await waitForFallbackPastMidpoint(page, 'close');

  const closingAnimationHandle = await detailSurface(page).evaluateHandle((element) => {
    const animations = element.getAnimations();
    if (animations.length !== 1) {
      throw new Error(`Expected exactly one running fallback close animation, found ${animations.length}`);
    }

    const animation = animations[0];
    if (!animation) {
      throw new Error('Expected fallback close animation handle to exist');
    }

    if (animation.playState !== 'running') {
      throw new Error(`Expected fallback close animation to be running, found ${animation.playState}`);
    }

    return animation;
  });
  const closingAnimationFinishedHandle = await closingAnimationHandle.evaluateHandle((animation) => ({
    finished: animation.finished,
  }));

  try {
    await closingAnimationFinishedHandle.evaluate(({ finished }) => finished);
  } finally {
    await closingAnimationFinishedHandle.dispose();
    await closingAnimationHandle.dispose();
  }

  await Promise.all([
    expect(cardTrigger(page, 0)).toBeFocused({ timeout: 4_500 }),
    expect(detailSurface(page)).toBeHidden({ timeout: 4_500 }),
    expect(root(page)).toHaveAttribute('data-transition-state', 'idle', { timeout: 4_500 }),
    expect(overlay(page)).toHaveCount(0, { timeout: 4_500 }),
    expect
      .poll(async () => (await fallbackAnimationSnapshot(page)).animationCount, { timeout: 4_500 })
      .toBe(0),
    expect.poll(() => detailInlineClip(page), { timeout: 4_500 }).toBe(CLOSED_TOP_RIGHT_CLIP),
  ]);

  const postCloseDetailState = await fullMotionDetailSnapshot(page);
  expect(postCloseDetailState.hidden).toBe(true);
  expect(postCloseDetailState.inert).toBe(true);
  expect(postCloseDetailState.opacity).toBe(1);
  expect(postCloseDetailState.transform).toBe('none');
  expect(postCloseDetailState.animationCount).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setDurationMs(page, 10_000);
  await cardTrigger(page, 0).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(root(page)).toHaveAttribute('data-transition-state', 'opening');
  await page.waitForFunction(() => {
    const overlayElement = document.querySelector<HTMLElement>('.paper-turn-overlay');
    const detailElement = document.querySelector<HTMLElement>('[data-detail-surface]');
    const progress = Number(overlayElement?.getAttribute('data-progress'));

    return (
      overlayElement !== null &&
      detailElement !== null &&
      !detailElement.hidden &&
      Number.isFinite(progress) &&
      progress > 0.25 &&
      progress < 0.75
    );
  });

  const detailState = await fullMotionDetailSnapshot(page);
  expect(detailState.hidden).toBe(false);
  expect(detailState.inert).toBe(true);
  expect(detailState.visibility).toBe('visible');
  expect(detailState.opacity).toBe(1);
  expect(detailState.transform).toBe('none');
  expect(detailState.animationCount).toBe(0);

  await Promise.all([
    expect(root(page)).toHaveAttribute('data-transition-state', 'open', { timeout: 12_000 }),
    expect(detailHeading(page)).toBeFocused({ timeout: 12_000 }),
    expect(overlay(page)).toHaveCount(0, { timeout: 12_000 }),
  ]);
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
