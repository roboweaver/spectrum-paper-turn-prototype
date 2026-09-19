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

/**
 * The eight grab anchors, and the pattern the published value must match. The
 * four rect-corner names are a subset of the eight, so sweeping this list also
 * sweeps every legacy corner value an author might have written.
 */
const GRAB_ANCHOR_NAMES = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'bottom-right',
  'bottom-center',
  'bottom-left',
  'middle-left',
] as const;

type GrabAnchorName = (typeof GRAB_ANCHOR_NAMES)[number];

const GRAB_ANCHOR_PATTERN = new RegExp(`^(?:${GRAB_ANCHOR_NAMES.join('|')})$`);

/**
 * The degenerate three-point clip the coordinator writes on the hidden detail
 * surface for each anchor: the anchor's own unit-square coordinate, in percent,
 * repeated three times. Authored here from the anchor names rather than imported
 * from the coordinator, so a change to the percentage mapping fails this suite
 * instead of agreeing with itself.
 */
const CLOSED_CLIP: Record<GrabAnchorName, string> = {
  'top-left': 'polygon(0% 0%, 0% 0%, 0% 0%)',
  'top-center': 'polygon(50% 0%, 50% 0%, 50% 0%)',
  'top-right': 'polygon(100% 0%, 100% 0%, 100% 0%)',
  'middle-right': 'polygon(100% 50%, 100% 50%, 100% 50%)',
  'bottom-right': 'polygon(100% 100%, 100% 100%, 100% 100%)',
  'bottom-center': 'polygon(50% 100%, 50% 100%, 50% 100%)',
  'bottom-left': 'polygon(0% 100%, 0% 100%, 0% 100%)',
  'middle-left': 'polygon(0% 50%, 0% 50%, 0% 50%)',
};

/**
 * The anchor each demo tile resolves, by the grid shape the three tiles measure
 * into. The demo lays out exactly three tiles, so only these three shapes are
 * reachable, and each project meets a different one at its own device width:
 * `chromium-desktop` lands on the single row, both mobile projects on the single
 * column. Written out per tile index so the closed-clip assertions below stay
 * literal without pinning a viewport, and read as a cross-check of the anchors
 * the dedicated resolution tests assert against the published attribute.
 */
const DEMO_TILE_ANCHORS: Record<string, readonly GrabAnchorName[]> = {
  // One row of three columns: degenerate, so the row's ends take bottom corners
  // and its centre tile takes the middle-band edge anchor.
  '1x3': ['bottom-left', 'middle-left', 'bottom-right'],
  // Two rows of two columns, the only non-degenerate shape three tiles reach.
  '2x2': ['top-left', 'top-right', 'bottom-left'],
  // One column of three rows: degenerate the other way.
  '3x1': ['top-right', 'top-center', 'bottom-right'],
};

/**
 * Viewports chosen from the demo's measured layout, not from the media queries:
 * the grid is `repeat(auto-fit, minmax(min(100%, 240px), 1fr))` over three tiles
 * with a 24px gap, inside a surface padded by `clamp(24px, 5vw, 72px)`.
 *
 * - 1280px lays the three tiles out in a single row of three columns.
 * - 700px fits two columns, so the three tiles form two rows, and stays clear of
 *   the 600px breakpoint that would collapse the grid to one column.
 * - 400px is below that breakpoint, so the grid is one column of three rows —
 *   the same shape both mobile projects lay out at their own device widths.
 */
const THREE_COLUMN_VIEWPORT = { width: 1280, height: 900 };
const TWO_COLUMN_VIEWPORT = { width: 700, height: 900 };
const SINGLE_COLUMN_VIEWPORT = { width: 400, height: 900 };

/** The turn has to still be in flight when the anchor is read. */
const ANCHOR_PROBE_QUERY = '/?duration=8000';

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

/**
 * The shape of the grid as laid out, reduced to the two counts the anchor
 * resolution turns on. This is a precondition check on the CSS, not a second
 * implementation of the resolver: the anchor itself is always read from the
 * overlay dataset rather than derived from pixels here.
 */
async function measuredGridShape(page: Page) {
  return page.locator('[data-card-trigger]').evaluateAll((elements) => {
    const rects = elements.map((element) => element.getBoundingClientRect());
    return {
      tileCount: rects.length,
      rowCount: new Set(rects.map((rect) => Math.round(rect.top))).size,
      columnCount: new Set(rects.map((rect) => Math.round(rect.left))).size,
    };
  });
}

/**
 * The closed clip the coordinator must write for a given tile, derived from the
 * grid shape the tiles currently measure into rather than from a pinned anchor.
 *
 * Must be called while the page is idle and the tiles are laid out, since it
 * measures them. The fallback and reduced-motion paths create no overlay, so
 * `publishedAnchorForTile` is unavailable on exactly the paths that need this.
 */
async function closedClipForTile(page: Page, index: number): Promise<string> {
  const { tileCount, rowCount, columnCount } = await measuredGridShape(page);
  const shape = `${rowCount}x${columnCount}`;
  const anchors = DEMO_TILE_ANCHORS[shape];

  if (anchors === undefined) {
    throw new Error(`No expected anchors authored for a ${shape} grid of ${tileCount} demo tiles`);
  }

  const anchor = anchors[index];

  if (anchor === undefined) {
    throw new Error(`No expected anchor authored for tile ${index} of a ${shape} grid`);
  }

  return CLOSED_CLIP[anchor];
}

/**
 * Activate one tile, read the anchor the renderer published for that activation,
 * then cancel back to idle so the next activation measures the same layout.
 *
 * The renderer writes `overlay.dataset.grabAnchor` when it creates the overlay,
 * before the first animation frame, so the attribute is already present the
 * moment the element exists.
 */
async function publishedAnchorForTile(page: Page, index: number): Promise<string | null> {
  await cardTrigger(page, index).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toHaveAttribute('data-grab-anchor', GRAB_ANCHOR_PATTERN);
  const anchor = await overlay(page).getAttribute('data-grab-anchor');

  await page.keyboard.press('Escape');
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);

  return anchor;
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
  // The turn has to still be in flight when Escape lands, and every assertion
  // below costs a round-trip to the browser. 2000ms is comfortable locally but
  // not on a shared CI runner, where the open can settle before the keypress.
  await page.goto('/?duration=8000');

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
  await setDurationMs(page, 8000);

  await closeButton(page).click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toBeVisible();
  // Assert on the sample the predicate actually validated. Re-reading
  // data-progress afterwards races the animation: the value has moved on by the
  // time the second round-trip lands.
  const closingProgressHandle = await page.waitForFunction(
    () => {
      const progress = Number(document.querySelector('.paper-turn-overlay')?.getAttribute('data-progress'));
      return Number.isFinite(progress) && progress > 0.5 && progress < 0.95 ? progress : null;
    },
    { timeout: 10000 },
  );
  const closingProgress = await closingProgressHandle.jsonValue();
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

  const reducedMotionClosedClip = await closedClipForTile(page, 0);

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Spectrum foundations');
  await expect(overlay(page)).toHaveCount(0);
  await closeButton(page).click();
  await expect(cardTrigger(page, 0)).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(reducedMotionClosedClip);

  await cardTrigger(page, 0).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Spectrum foundations');
  await expect(root(page)).toHaveAttribute('data-transition-state', 'open');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(FULL_CLIP);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?fallback=1');

  // The second tile, so the assertion also covers an anchor other than the one
  // the first tile resolves: a single row gives tile 1 a middle-band edge anchor
  // where tile 0 takes a corner.
  const fallbackClosedClip = await closedClipForTile(page, 1);

  await cardTrigger(page, 1).click();
  await expect(detailSurface(page)).toBeVisible();
  await expect(detailHeading(page)).toHaveText('Workflow patterns');
  await expect(overlay(page)).toHaveCount(0);
  await closeButton(page).click();
  await expect(cardTrigger(page, 1)).toBeFocused();
  await expect(detailSurface(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-transition-state', 'idle');
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => detailInlineClip(page)).toBe(fallbackClosedClip);

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

  const closedClip = await closedClipForTile(page, 0);

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
    expect.poll(() => detailInlineClip(page), { timeout: 1_800 }).toBe(closedClip),
    expect
      .poll(async () => (await fallbackAnimationSnapshot(page)).animationCount, { timeout: 1_800 })
      .toBe(0),
  ]);
});

test('mixed fallback close cleanup does not poison the next full-motion reopen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?duration=120');

  const closedClip = await closedClipForTile(page, 0);

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
    expect.poll(() => detailInlineClip(page), { timeout: 4_500 }).toBe(closedClip),
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

test('the close button label stays on one line when its width is squeezed', async ({ page }) => {
  // html-to-image inlines the live button's height onto its clone, so a label
  // that wraps in the capture spills out of a pill that can no longer grow.
  // The label must therefore never wrap, whatever font the browser resolves.
  await page.goto('/?duration=120');
  await cardTrigger(page, 0).click();
  await expect(page.locator('[data-detail-surface]')).toBeVisible();

  const measured = await closeButton(page).evaluate((button) => {
    const label = (button as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot.querySelector('#label');
    const naturalHeight = label!.getBoundingClientRect().height;

    (button as HTMLElement).style.width = '84px';
    const squeezedHeight = label!.getBoundingClientRect().height;
    (button as HTMLElement).style.width = '';

    return { naturalHeight, squeezedHeight, whiteSpace: getComputedStyle(label!).whiteSpace };
  });

  expect(measured.whiteSpace).toBe('nowrap');
  expect(measured.squeezedHeight).toBeCloseTo(measured.naturalHeight, 1);
});

test('desktop widths publish the anchor the measured grid position implies', async ({ page }) => {
  await page.goto(ANCHOR_PROBE_QUERY);

  // Two columns, so the three tiles occupy two rows and the first tile is
  // genuinely in the top-left band rather than in a degenerate single row.
  await page.setViewportSize(TWO_COLUMN_VIEWPORT);
  await expect.poll(() => measuredGridShape(page)).toEqual({ tileCount: 3, rowCount: 2, columnCount: 2 });

  expect(await publishedAnchorForTile(page, 0)).toBe('top-left');
  expect(await publishedAnchorForTile(page, 1)).toBe('top-right');
  expect(await publishedAnchorForTile(page, 2)).toBe('bottom-left');

  // One row of three columns, which is what the demo lays out at full desktop
  // width. A single row is degenerate, so the row-centre tile takes the
  // middle-band edge anchor `middle-left`: the transpose of the single-column
  // family. `middle-right` needs a true middle row beside a right column, which
  // is a grid of at least three rows by two columns and so is unreachable with
  // the demo's three tiles — the band table itself is enumerated exhaustively in
  // the unit suite.
  await page.setViewportSize(THREE_COLUMN_VIEWPORT);
  await expect.poll(() => measuredGridShape(page)).toEqual({ tileCount: 3, rowCount: 1, columnCount: 3 });

  expect(await publishedAnchorForTile(page, 0)).toBe('bottom-left');
  expect(await publishedAnchorForTile(page, 1)).toBe('middle-left');
});

test('the mobile single-column grid resolves top-right, top-center, and bottom-right', async ({ page }) => {
  await page.goto(ANCHOR_PROBE_QUERY);

  await page.setViewportSize(SINGLE_COLUMN_VIEWPORT);
  await expect.poll(() => measuredGridShape(page)).toEqual({ tileCount: 3, rowCount: 3, columnCount: 1 });

  expect(await publishedAnchorForTile(page, 0)).toBe('top-right');
  expect(await publishedAnchorForTile(page, 1)).toBe('top-center');
  expect(await publishedAnchorForTile(page, 2)).toBe('bottom-right');
});

test('an authored data-grabbed-corner attribute cannot move the published anchor', async ({ page }) => {
  // Twelve activations, each capturing the page before its overlay appears.
  // Comfortable locally, but not inside the default budget on a shared runner.
  test.setTimeout(90_000);

  const consoleNoise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleNoise.push(`${message.type()}: ${message.text()}`);
    }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(ANCHOR_PROBE_QUERY);
  await page.setViewportSize(SINGLE_COLUMN_VIEWPORT);
  await expect.poll(() => measuredGridShape(page)).toEqual({ tileCount: 3, rowCount: 3, columnCount: 1 });

  const baseline = await publishedAnchorForTile(page, 0);
  expect(baseline).toBe('top-right');

  // Every anchor name — the four rect corners among them — plus an empty and an
  // unrecognized string. The tile's grid position never changes, so each sweep
  // step also re-asserts that repeated activations of one tile over an unchanged
  // layout resolve the same anchor.
  for (const authored of [...GRAB_ANCHOR_NAMES, '', 'sideways']) {
    await cardTrigger(page, 0).evaluate((element, value) => {
      element.setAttribute('data-grabbed-corner', value);
    }, authored);

    expect(await publishedAnchorForTile(page, 0), `authored data-grabbed-corner="${authored}"`).toBe(baseline);
  }

  await cardTrigger(page, 0).evaluate((element) => {
    element.removeAttribute('data-grabbed-corner');
  });
  expect(await publishedAnchorForTile(page, 0)).toBe(baseline);

  expect(pageErrors).toEqual([]);
  expect(consoleNoise.filter((entry) => /anchor|corner|grab/i.test(entry))).toEqual([]);
});
