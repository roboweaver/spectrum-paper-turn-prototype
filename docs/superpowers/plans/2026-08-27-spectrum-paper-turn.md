# Spectrum Paper-Turn Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modern Spectrum Web Components browser demo in which a card opens into a full-viewport detail surface through a reversible, diagonal, paper-like WebGL turn with an accessible DOM fallback.

**Architecture:** Keep the list and detail experiences as real Spectrum DOM layers, with the detail layer stationary and progressively exposed by a diagonal CSS clip path. During motion, `TransitionCoordinator` drives one normalized timeline and a disposable Three.js `PaperTurnRenderer`; pure geometry functions produce the corner-swapping mesh and reveal mask, while explicit capability, capture, fallback, focus, scroll, inertness, cancellation, and cleanup boundaries keep failures recoverable.

**Tech Stack:** Vite 8.2.2, TypeScript 7.0.2, Spectrum Web Components 1.12.2, Three.js 0.185.1, html-to-image 1.11.13, Vitest 4.1.11 with jsdom 30.0.1, and Playwright 1.62.1.

---

## Locked File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Reproducible scripts and runtime/test dependencies. |
| `package-lock.json` | npm-generated dependency lockfile. |
| `tsconfig.json` | Strict browser TypeScript configuration. |
| `vite.config.ts` | Vite development and production build configuration. |
| `vitest.config.ts` | jsdom unit-test setup and test selection. |
| `playwright.config.ts` | Desktop/mobile browser projects, dev-server lifecycle, and screenshot policy. |
| `index.html` | Single Vite entry document. |
| `src/main.ts` | Imports Spectrum registrations and mounts the demo. |
| `src/app.ts` | Renders list/detail DOM, resolves cards, and wires coordinator events. |
| `src/styles.css` | Spectrum-compatible layout, fixed detail layer, reveal clipping, fallback, and reduced-motion styling. |
| `src/data/cards.ts` | Typed deterministic card/detail fixture data. |
| `src/transition/types.ts` | Shared geometry, renderer, capture, view, and coordinator contracts. |
| `src/transition/geometry.ts` | Corner normalization, diagonal exchange, mesh deformation, and reveal polygon clipping. |
| `src/transition/motion-profile.ts` | Central full/fallback timing, curvature, mesh, texture, and DPR limits. |
| `src/transition/timeline.ts` | Single cancellable `requestAnimationFrame` progress loop. |
| `src/transition/capabilities.ts` | Reduced-motion and WebGL prerequisite selection. |
| `src/transition/capture.ts` | Bounded-DPR source-card texture capture. |
| `src/transition/paper-shaders.ts` | Focused front/reverse-face shading shaders. |
| `src/transition/paper-turn-renderer.ts` | Short-lived Three.js overlay, indexed mesh updates, texture upload, render, and disposal. |
| `src/transition/fallback-transition.ts` | 180-220 ms Web Animations opacity/scale fallback. |
| `src/transition/dom-transition-view.ts` | DOM visibility, clip, inertness, source hiding, focus, and scroll operations. |
| `src/transition/transition-coordinator.ts` | `idle/preparing/opening/open/closing` state machine and recovery orchestration. |
| `tests/unit/geometry.test.ts` | Corner exchange, symmetry, deformation, and reveal-mask tests. |
| `tests/unit/motion-profile.test.ts` | Motion bounds and easing tests. |
| `tests/unit/timeline.test.ts` | Progress, reverse, and cancellation tests. |
| `tests/unit/capabilities.test.ts` | Full/fallback selection tests. |
| `tests/unit/capture.test.ts` | Texture DPR/size limiting and failure propagation tests. |
| `tests/unit/dom-transition-view.test.ts` | Focus, scroll, inertness, visibility, and missing-source tests. |
| `tests/unit/transition-coordinator.test.ts` | States, overlap, opening, closing, failure, Escape, and resize tests. |
| `tests/e2e/interaction.spec.ts` | Mouse, touch, keyboard, Escape, resize, multiple-card, and fallback browser tests. |
| `tests/e2e/visual.spec.ts` | Start, peak-curl, diagonal-midpoint, and settled visual checkpoints. |

## Locked Interfaces

All later tasks must preserve these names and signatures:

```ts
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
export type TransitionState = 'idle' | 'preparing' | 'opening' | 'open' | 'closing';
export type MotionMode = 'full' | 'fallback';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MotionProfile {
  durationMs: number;
  fallbackDurationMs: number;
  bendDepth: number;
  foldSoftness: number;
  edgeCurvature: number;
  shadowStrength: number;
  meshColumns: number;
  meshRows: number;
  maxTextureDpr: number;
  maxTexturePixels: number;
  easing: (progress: number) => number;
}

export interface PaperFrame {
  positions: Float32Array;
  shade: Float32Array;
  revealClipPath: string;
}

export interface RendererInput {
  sourceRect: Rect;
  destinationRect: Rect;
  grabbedCorner: Corner;
  texture: HTMLCanvasElement;
  profile: MotionProfile;
}

export interface PaperRenderer {
  render(progress: number): PaperFrame;
  dispose(): void;
}

export interface TransitionOpenRequest {
  sourceId: string;
  grabbedCorner: Corner;
  trigger: HTMLElement;
}

export interface TransitionView {
  prepareDetail(sourceId: string): void;
  measureDestination(): Rect;
  resolveSource(sourceId: string): HTMLElement | null;
  measureSource(source: HTMLElement): Rect;
  setDetailClip(clipPath: string): void;
  setSourceHidden(source: HTMLElement, hidden: boolean): void;
  setListVisible(visible: boolean): void;
  setDetailVisible(visible: boolean): void;
  setDetailInert(inert: boolean): void;
  setBusy(busy: boolean): void;
  freezeScroll(): void;
  restoreScroll(): void;
  focusDetailHeading(): void;
  focusListFallback(): void;
}

export interface TransitionDependencies {
  profile: MotionProfile;
  selectMotionMode(): MotionMode;
  capture(source: HTMLElement, profile: MotionProfile): Promise<HTMLCanvasElement>;
  createRenderer(input: RendererInput): PaperRenderer;
  runFallback(direction: 'open' | 'close', durationMs: number, signal: AbortSignal): Promise<void>;
  animate(
    from: number,
    to: number,
    durationMs: number,
    onFrame: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
```

The diagonal geometry uses the configured grabbed corner as canonical `(0, 0)` and its opposite as `(1, 1)`. At normalized progress `1`, the grabbed mesh vertex must equal the destination's opposite corner, while the original opposite mesh vertex must equal the grabbed corner's original source position. The destination remains fixed; only its clip path changes.

### Task 1: Scaffold the Strict Browser Project

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `index.html`

- [ ] **Step 1: Create the package manifest**

Create `package.json`:

```json
{
  "name": "spectrum-paper-turn-prototype",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "playwright test tests/e2e/interaction.spec.ts",
    "test:visual": "playwright test tests/e2e/visual.spec.ts",
    "test:all": "npm run test:unit && npm run build && playwright test"
  },
  "dependencies": {
    "@spectrum-web-components/button": "1.12.2",
    "@spectrum-web-components/card": "1.12.2",
    "@spectrum-web-components/theme": "1.12.2",
    "html-to-image": "1.11.13",
    "three": "0.185.1"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "@types/node": "26.4.0",
    "@types/three": "0.185.4",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Install dependencies and generate the lockfile**

Run: `npm install`

Expected: exit 0, `package-lock.json` is created, and npm reports no unresolved dependency errors.

- [ ] **Step 3: Add strict TypeScript and tool configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
  },
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f5f5f5" />
    <title>Spectrum Paper Turn</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Verify the scaffold configuration**

Run: `npx tsc --noEmit`

Expected: TypeScript validates the configuration files with exit 0.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts index.html
git commit -m "build: scaffold paper-turn prototype"
```

### Task 2: Build the Accessible Spectrum DOM Endpoints

**Files:**
- Create: `src/data/cards.ts`
- Create: `src/app.ts`
- Create: `src/main.ts`
- Create: `src/styles.css`
- Test: `tests/unit/app.test.ts`

- [ ] **Step 1: Write the failing DOM endpoint test**

Create `tests/unit/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDemoApp } from '../../src/app';

describe('createDemoApp', () => {
  it('renders keyboard-operable cards and one hidden inert detail endpoint', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    expect(root.querySelectorAll<HTMLButtonElement>('[data-card-trigger]')).toHaveLength(3);
    expect(app.listSurface.getAttribute('aria-busy')).toBe('false');
    expect(app.detailSurface.hidden).toBe(true);
    expect(app.detailSurface.inert).toBe(true);
    expect(app.listFocusFallback.tabIndex).toBe(-1);
  });

  it('renders deterministic detail content for a selected source id', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.renderDetail('spectrum');

    expect(app.detailHeading.textContent).toBe('Spectrum foundations');
    expect(app.detailSurface.textContent).toContain('Color, typography, and layout');
  });
});
```

- [ ] **Step 2: Run the DOM endpoint test to verify it fails**

Run: `npm run test:unit -- tests/unit/app.test.ts`

Expected: FAIL with `Cannot find module '../../src/app'`.

- [ ] **Step 3: Add deterministic card data**

Create `src/data/cards.ts`:

```ts
export interface CardRecord {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
}

export const cards: readonly CardRecord[] = [
  {
    id: 'spectrum',
    title: 'Spectrum foundations',
    subtitle: 'Design system',
    description: 'Color, typography, and layout for coherent product experiences.',
    color: '#5c5ce0',
  },
  {
    id: 'workflow',
    title: 'Workflow patterns',
    subtitle: 'Interaction',
    description: 'Predictable controls and feedback for focused creative work.',
    color: '#d83790',
  },
  {
    id: 'content',
    title: 'Content surfaces',
    subtitle: 'Presentation',
    description: 'Responsive structures that preserve hierarchy across devices.',
    color: '#268e6c',
  },
] as const;

export function cardById(id: string): CardRecord {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return card;
}
```

- [ ] **Step 4: Add the DOM app with explicit endpoint handles**

Create `src/app.ts`:

```ts
import { cardById, cards } from './data/cards';

export interface DemoApp {
  listSurface: HTMLElement;
  detailSurface: HTMLElement;
  detailHeading: HTMLElement;
  listFocusFallback: HTMLElement;
  closeButton: HTMLElement;
  renderDetail(sourceId: string): void;
  resolveSource(sourceId: string): HTMLElement | null;
}

function cardMarkup(id: string, title: string, subtitle: string, description: string, color: string): string {
  return `
    <button class="card-trigger" data-card-trigger data-source-id="${id}" type="button">
      <sp-card heading="${title}" subheading="${subtitle}" size="s">
        <div slot="preview" class="card-preview" style="--card-color: ${color}"></div>
        <p>${description}</p>
      </sp-card>
    </button>
  `;
}

export function createDemoApp(root: HTMLElement): DemoApp {
  root.innerHTML = `
    <sp-theme system="spectrum" color="light" scale="medium">
      <main class="demo-shell">
        <section class="list-surface" data-list-surface aria-busy="false">
          <header class="hero">
            <p class="eyebrow">Spectrum Web Components prototype</p>
            <h1>Paper-turn navigation</h1>
            <p>Choose a card to open a full-page detail surface.</p>
          </header>
          <div class="card-grid" data-list-focus-fallback tabindex="-1" aria-label="Design topics">
            ${cards.map((card) => cardMarkup(card.id, card.title, card.subtitle, card.description, card.color)).join('')}
          </div>
        </section>
        <article class="detail-surface" data-detail-surface hidden>
          <div class="detail-toolbar">
            <sp-button data-close-button variant="secondary">Back to cards</sp-button>
          </div>
          <div class="detail-content">
            <p class="eyebrow" data-detail-subtitle></p>
            <h2 data-detail-heading tabindex="-1"></h2>
            <p data-detail-description></p>
          </div>
        </article>
      </main>
    </sp-theme>
  `;

  const listSurface = root.querySelector<HTMLElement>('[data-list-surface]');
  const detailSurface = root.querySelector<HTMLElement>('[data-detail-surface]');
  const detailHeading = root.querySelector<HTMLElement>('[data-detail-heading]');
  const listFocusFallback = root.querySelector<HTMLElement>('[data-list-focus-fallback]');
  const closeButton = root.querySelector<HTMLElement>('[data-close-button]');
  const detailSubtitle = root.querySelector<HTMLElement>('[data-detail-subtitle]');
  const detailDescription = root.querySelector<HTMLElement>('[data-detail-description]');

  if (!listSurface || !detailSurface || !detailHeading || !listFocusFallback || !closeButton || !detailSubtitle || !detailDescription) {
    throw new Error('Demo DOM contract is incomplete');
  }

  detailSurface.inert = true;

  return {
    listSurface,
    detailSurface,
    detailHeading,
    listFocusFallback,
    closeButton,
    renderDetail(sourceId: string) {
      const card = cardById(sourceId);
      detailHeading.textContent = card.title;
      detailSubtitle.textContent = card.subtitle;
      detailDescription.textContent = card.description;
      detailSurface.style.setProperty('--detail-color', card.color);
    },
    resolveSource(sourceId: string) {
      return root.querySelector<HTMLElement>(`[data-card-trigger][data-source-id="${sourceId}"]`);
    },
  };
}
```

- [ ] **Step 5: Add entrypoint and endpoint styling**

Create `src/main.ts`:

```ts
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/card/sp-card.js';
import '@spectrum-web-components/button/sp-button.js';
import './styles.css';
import { createDemoApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

createDemoApp(root);
```

Create `src/styles.css`:

```css
:root {
  color-scheme: light;
  font-family: var(--spectrum-sans-font-family-stack, system-ui, sans-serif);
  background: #f5f5f5;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-width: 320px;
  min-height: 100%;
}

button {
  font: inherit;
}

.demo-shell {
  position: relative;
  min-height: 100vh;
  overflow: clip;
}

.list-surface {
  min-height: 100vh;
  padding: clamp(24px, 5vw, 72px);
  background: linear-gradient(145deg, #f8f8f8, #ececec);
}

.hero {
  max-width: 760px;
  margin-bottom: 32px;
}

.hero h1,
.detail-content h2 {
  margin: 0 0 12px;
  font-size: clamp(2.4rem, 8vw, 5.5rem);
  line-height: 0.95;
}

.eyebrow {
  margin: 0 0 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 24px;
}

.card-trigger {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.card-trigger:focus-visible {
  outline: 3px solid #1473e6;
  outline-offset: 5px;
}

sp-card {
  width: 100%;
  min-height: 330px;
}

.card-preview {
  width: 100%;
  min-height: 190px;
  background:
    radial-gradient(circle at 75% 20%, rgb(255 255 255 / 55%), transparent 28%),
    linear-gradient(145deg, color-mix(in srgb, var(--card-color), white 20%), var(--card-color));
}

.detail-surface {
  position: fixed;
  z-index: 20;
  inset: 0;
  min-height: 100vh;
  padding: clamp(24px, 5vw, 72px);
  overflow: auto;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--detail-color), white 88%), white 72%),
    white;
  clip-path: polygon(0 0, 0 0, 0 0);
  will-change: clip-path, opacity, transform;
}

.detail-toolbar {
  display: flex;
  justify-content: flex-end;
}

.detail-content {
  max-width: 900px;
  margin-top: clamp(64px, 12vh, 160px);
}

.detail-content h2:focus {
  outline: none;
}

[data-transition-hidden='true'] {
  visibility: hidden;
}

.paper-turn-overlay {
  position: fixed;
  z-index: 30;
  inset: 0;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .detail-surface {
    will-change: opacity;
  }
}
```

- [ ] **Step 6: Run the DOM endpoint test and build**

Run: `npm run test:unit -- tests/unit/app.test.ts && npm run build`

Expected: 2 tests PASS; TypeScript and Vite build exit 0.

- [ ] **Step 7: Commit the accessible endpoints**

```bash
git add src tests/unit/app.test.ts
git commit -m "feat: add Spectrum list and detail endpoints"
```

### Task 3: Implement Generalized Corner-Exchange Geometry

**Files:**
- Create: `src/transition/types.ts`
- Create: `src/transition/geometry.ts`
- Test: `tests/unit/geometry.test.ts`

- [ ] **Step 1: Write failing corner, symmetry, mesh, and reveal tests**

Create `tests/unit/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPaperFrame,
  cornerPoint,
  oppositeCorner,
  revealClipPath,
  vertexIndex,
} from '../../src/transition/geometry';
import type { Corner, MotionProfile, Rect } from '../../src/transition/types';

const source: Rect = { left: 100, top: 80, width: 240, height: 160 };
const destination: Rect = { left: 0, top: 0, width: 1000, height: 700 };
const profile: MotionProfile = {
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 110,
  foldSoftness: 0.16,
  edgeCurvature: 18,
  shadowStrength: 0.42,
  meshColumns: 2,
  meshRows: 2,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: (progress) => progress,
};

const corners: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

describe('paper geometry', () => {
  it.each([
    ['top-left', 'bottom-right'],
    ['top-right', 'bottom-left'],
    ['bottom-right', 'top-left'],
    ['bottom-left', 'top-right'],
  ] as const)('maps %s to opposite %s', (corner, opposite) => {
    expect(oppositeCorner(corner)).toBe(opposite);
  });

  it.each(corners)('starts aligned to the source for %s', (grabbedCorner) => {
    const frame = buildPaperFrame(source, destination, grabbedCorner, 0, profile);
    const grabbed = vertexIndex(grabbedCorner, profile.meshColumns, profile.meshRows);
    const start = cornerPoint(source, grabbedCorner);

    expect(Array.from(frame.positions.slice(grabbed * 3, grabbed * 3 + 2))).toEqual([start.x, start.y]);
  });

  it.each(corners)('exchanges diagonal positions for %s', (grabbedCorner) => {
    const frame = buildPaperFrame(source, destination, grabbedCorner, 1, profile);
    const opposite = oppositeCorner(grabbedCorner);
    const grabbedIndex = vertexIndex(grabbedCorner, profile.meshColumns, profile.meshRows);
    const oppositeIndex = vertexIndex(opposite, profile.meshColumns, profile.meshRows);
    const grabbedEnd = cornerPoint(destination, opposite);
    const tuckedEnd = cornerPoint(source, grabbedCorner);

    expect(Array.from(frame.positions.slice(grabbedIndex * 3, grabbedIndex * 3 + 2))).toEqual([grabbedEnd.x, grabbedEnd.y]);
    expect(Array.from(frame.positions.slice(oppositeIndex * 3, oppositeIndex * 3 + 2))).toEqual([tuckedEnd.x, tuckedEnd.y]);
  });

  it('creates depth at peak curl and no depth at either endpoint', () => {
    const start = buildPaperFrame(source, destination, 'top-right', 0, profile);
    const peak = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const end = buildPaperFrame(source, destination, 'top-right', 1, profile);

    expect(Math.max(...start.positions.filter((_, index) => index % 3 === 2))).toBe(0);
    expect(Math.max(...peak.positions.filter((_, index) => index % 3 === 2))).toBeGreaterThan(100);
    expect(Math.max(...end.positions.filter((_, index) => index % 3 === 2))).toBeCloseTo(0, 5);
  });

  it('curves a side edge away from a straight endpoint interpolation', () => {
    const frame = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const leftY = frame.positions[1]!;
    const middleY = frame.positions[4]!;
    const rightY = frame.positions[7]!;
    expect(middleY).not.toBeCloseTo((leftY + rightY) / 2, 3);
  });

  it('reveals no viewport at zero and the full viewport at one', () => {
    expect(revealClipPath(destination, 'top-right', 0)).toBe('polygon(100% 0%, 100% 0%, 100% 0%)');
    expect(revealClipPath(destination, 'top-right', 1)).toBe('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)');
  });
});
```

- [ ] **Step 2: Run geometry tests to verify they fail**

Run: `npm run test:unit -- tests/unit/geometry.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/geometry'`.

- [ ] **Step 3: Define the shared transition contracts**

Create `src/transition/types.ts`:

```ts
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
export type TransitionState = 'idle' | 'preparing' | 'opening' | 'open' | 'closing';
export type MotionMode = 'full' | 'fallback';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MotionProfile {
  durationMs: number;
  fallbackDurationMs: number;
  bendDepth: number;
  foldSoftness: number;
  edgeCurvature: number;
  shadowStrength: number;
  meshColumns: number;
  meshRows: number;
  maxTextureDpr: number;
  maxTexturePixels: number;
  easing: (progress: number) => number;
}

export interface PaperFrame {
  positions: Float32Array;
  shade: Float32Array;
  revealClipPath: string;
}

export interface RendererInput {
  sourceRect: Rect;
  destinationRect: Rect;
  grabbedCorner: Corner;
  texture: HTMLCanvasElement;
  profile: MotionProfile;
}

export interface PaperRenderer {
  render(progress: number): PaperFrame;
  dispose(): void;
}

export interface TransitionOpenRequest {
  sourceId: string;
  grabbedCorner: Corner;
  trigger: HTMLElement;
}

export interface TransitionView {
  prepareDetail(sourceId: string): void;
  measureDestination(): Rect;
  resolveSource(sourceId: string): HTMLElement | null;
  measureSource(source: HTMLElement): Rect;
  setDetailClip(clipPath: string): void;
  setSourceHidden(source: HTMLElement, hidden: boolean): void;
  setListVisible(visible: boolean): void;
  setDetailVisible(visible: boolean): void;
  setDetailInert(inert: boolean): void;
  setBusy(busy: boolean): void;
  freezeScroll(): void;
  restoreScroll(): void;
  focusDetailHeading(): void;
  focusListFallback(): void;
}

export interface TransitionDependencies {
  profile: MotionProfile;
  selectMotionMode(): MotionMode;
  capture(source: HTMLElement, profile: MotionProfile): Promise<HTMLCanvasElement>;
  createRenderer(input: RendererInput): PaperRenderer;
  runFallback(direction: 'open' | 'close', durationMs: number, signal: AbortSignal): Promise<void>;
  animate(
    from: number,
    to: number,
    durationMs: number,
    onFrame: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface CaptureOptions {
  pixelRatio: number;
  width: number;
  height: number;
}

export interface FullMotionPrerequisites {
  reducedMotion: boolean;
  webglAvailable: boolean;
  captureAvailable: boolean;
}
```

- [ ] **Step 4: Implement deterministic paper geometry**

Create `src/transition/geometry.ts`:

```ts
import type { Corner, MotionProfile, PaperFrame, Point, Rect } from './types';

const cornerUv: Record<Corner, Point> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-left': { x: 0, y: 1 },
};

export function oppositeCorner(corner: Corner): Corner {
  const opposites: Record<Corner, Corner> = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-right': 'top-left',
    'bottom-left': 'top-right',
  };
  return opposites[corner];
}

export function cornerPoint(rect: Rect, corner: Corner): Point {
  const uv = cornerUv[corner];
  return {
    x: rect.left + uv.x * rect.width,
    y: rect.top + uv.y * rect.height,
  };
}

export function vertexIndex(corner: Corner, columns: number, rows: number): number {
  const uv = cornerUv[corner];
  return uv.y * rows * (columns + 1) + uv.x * columns;
}

function mix(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

function bilinear(corners: readonly [Point, Point, Point, Point], u: number, v: number): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return {
    x: mix(mix(topLeft.x, topRight.x, u), mix(bottomLeft.x, bottomRight.x, u), v),
    y: mix(mix(topLeft.y, topRight.y, u), mix(bottomLeft.y, bottomRight.y, u), v),
  };
}

function orderedCorners(rect: Rect): [Point, Point, Point, Point] {
  return [
    cornerPoint(rect, 'top-left'),
    cornerPoint(rect, 'top-right'),
    cornerPoint(rect, 'bottom-right'),
    cornerPoint(rect, 'bottom-left'),
  ];
}

function endCorners(source: Rect, destination: Rect, grabbed: Corner): [Point, Point, Point, Point] {
  const result = orderedCorners(destination);
  const order: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  result[order.indexOf(grabbed)] = cornerPoint(destination, oppositeCorner(grabbed));
  result[order.indexOf(oppositeCorner(grabbed))] = cornerPoint(source, grabbed);
  return result;
}

function canonicalDistance(u: number, v: number, grabbed: Corner): number {
  const origin = cornerUv[grabbed];
  return Math.abs(u - origin.x) + Math.abs(v - origin.y);
}

function clipViewport(rect: Rect, grabbed: Corner, progress: number): Point[] {
  const origin = cornerUv[grabbed];
  const threshold = progress * 2;
  const corners = orderedCorners(rect);
  const normalized = corners.map((point) => ({
    point,
    distance:
      Math.abs((point.x - rect.left) / rect.width - origin.x) +
      Math.abs((point.y - rect.top) / rect.height - origin.y),
  }));
  const output: Point[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    const currentInside = current.distance <= threshold;
    const nextInside = next.distance <= threshold;

    if (currentInside) {
      output.push(current.point);
    }
    if (currentInside !== nextInside) {
      const edgeProgress = (threshold - current.distance) / (next.distance - current.distance);
      output.push({
        x: mix(current.point.x, next.point.x, edgeProgress),
        y: mix(current.point.y, next.point.y, edgeProgress),
      });
    }
  }
  return output;
}

export function revealClipPath(rect: Rect, grabbed: Corner, progress: number): string {
  if (progress <= 0) {
    const point = cornerPoint(rect, grabbed);
    const x = ((point.x - rect.left) / rect.width) * 100;
    const y = ((point.y - rect.top) / rect.height) * 100;
    return `polygon(${x}% ${y}%, ${x}% ${y}%, ${x}% ${y}%)`;
  }
  if (progress >= 1) {
    return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  }
  return `polygon(${clipViewport(rect, grabbed, progress)
    .map((point) => `${((point.x - rect.left) / rect.width) * 100}% ${((point.y - rect.top) / rect.height) * 100}%`)
    .join(', ')})`;
}

export function buildPaperFrame(
  source: Rect,
  destination: Rect,
  grabbed: Corner,
  progress: number,
  profile: MotionProfile,
): PaperFrame {
  const eased = profile.easing(Math.min(1, Math.max(0, progress)));
  const start = orderedCorners(source);
  const end = endCorners(source, destination, grabbed);
  const vertexCount = (profile.meshColumns + 1) * (profile.meshRows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const shade = new Float32Array(vertexCount);
  const curl = Math.sin(Math.PI * eased);

  for (let row = 0; row <= profile.meshRows; row += 1) {
    const v = row / profile.meshRows;
    for (let column = 0; column <= profile.meshColumns; column += 1) {
      const u = column / profile.meshColumns;
      const index = row * (profile.meshColumns + 1) + column;
      const from = bilinear(start, u, v);
      const to = bilinear(end, u, v);
      const distance = canonicalDistance(u, v, grabbed);
      const foldDistance = Math.abs(distance - eased * 2);
      const foldInfluence = Math.exp(-(foldDistance * foldDistance) / profile.foldSoftness);
      const edgeWave = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const edgeDistance = Math.min(u, 1 - u, v, 1 - v);
      const edgeInfluence = 1 - Math.min(1, edgeDistance * 4);
      const edgeBend = Math.sin(Math.PI * (u + v)) * edgeInfluence * profile.edgeCurvature * curl;
      const grabbedUv = cornerUv[grabbed];

      positions[index * 3] =
        mix(from.x, to.x, eased) + edgeBend * (grabbedUv.x === 0 ? 0.45 : -0.45);
      positions[index * 3 + 1] =
        mix(from.y, to.y, eased) +
        edgeWave * profile.edgeCurvature * curl +
        edgeBend * (grabbedUv.y === 0 ? 1 : -1);
      positions[index * 3 + 2] =
        curl * (profile.bendDepth * foldInfluence + profile.edgeCurvature * edgeWave);
      shade[index] = Math.min(1, 0.35 + foldInfluence * 0.65);
    }
  }

  return {
    positions,
    shade,
    revealClipPath: revealClipPath(destination, grabbed, eased),
  };
}
```

- [ ] **Step 5: Run geometry tests**

Run: `npm run test:unit -- tests/unit/geometry.test.ts`

Expected: all 15 geometry tests PASS.

- [ ] **Step 6: Commit the geometry**

```bash
git add src/transition/types.ts src/transition/geometry.ts tests/unit/geometry.test.ts
git commit -m "feat: add diagonal corner-exchange geometry"
```

### Task 4: Centralize Motion and the Single Frame Loop

**Files:**
- Create: `src/transition/motion-profile.ts`
- Create: `src/transition/timeline.ts`
- Test: `tests/unit/motion-profile.test.ts`
- Test: `tests/unit/timeline.test.ts`

- [ ] **Step 1: Write failing motion profile tests**

Create `tests/unit/motion-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultMotionProfile } from '../../src/transition/motion-profile';

describe('defaultMotionProfile', () => {
  it('stays inside approved timing, mesh, and texture limits', () => {
    expect(defaultMotionProfile.durationMs).toBeGreaterThanOrEqual(650);
    expect(defaultMotionProfile.durationMs).toBeLessThanOrEqual(800);
    expect(defaultMotionProfile.fallbackDurationMs).toBeGreaterThanOrEqual(180);
    expect(defaultMotionProfile.fallbackDurationMs).toBeLessThanOrEqual(220);
    expect(defaultMotionProfile.meshColumns).toBe(20);
    expect(defaultMotionProfile.meshRows).toBe(14);
    expect(defaultMotionProfile.maxTextureDpr).toBeLessThanOrEqual(2);
  });

  it('has a monotonic easing with exact endpoints', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(defaultMotionProfile.easing);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: Run the profile test to verify it fails**

Run: `npm run test:unit -- tests/unit/motion-profile.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/motion-profile'`.

- [ ] **Step 3: Implement the profile**

Create `src/transition/motion-profile.ts`:

```ts
import type { MotionProfile } from './types';

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) {
    return 4 * progress * progress * progress;
  }
  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export const defaultMotionProfile: MotionProfile = Object.freeze({
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 120,
  foldSoftness: 0.14,
  edgeCurvature: 20,
  shadowStrength: 0.42,
  meshColumns: 20,
  meshRows: 14,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: easeInOutCubic,
});
```

- [ ] **Step 4: Run the profile test**

Run: `npm run test:unit -- tests/unit/motion-profile.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Write failing timeline tests**

Create `tests/unit/timeline.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { animateProgress } from '../../src/transition/timeline';

describe('animateProgress', () => {
  it('emits exact endpoints in forward and reverse directions', async () => {
    const frames: FrameRequestCallback[] = [];
    let now = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const values: number[] = [];
    const promise = animateProgress(0, 1, 100, values.push.bind(values), new AbortController().signal, {
      now: () => now,
      requestFrame,
      cancelFrame: vi.fn(),
    });

    while (frames.length > 0) {
      now += 50;
      frames.shift()!(now);
    }
    await promise;

    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
  });

  it('rejects with AbortError and cancels the queued frame', async () => {
    const controller = new AbortController();
    const cancelFrame = vi.fn();
    const promise = animateProgress(0, 1, 100, vi.fn(), controller.signal, {
      now: () => 0,
      requestFrame: () => 42,
      cancelFrame,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it('rejects when frame rendering throws instead of orphaning the loop', async () => {
    const frames: FrameRequestCallback[] = [];
    const failure = new Error('render failed');
    const promise = animateProgress(0, 1, 100, () => {
      throw failure;
    }, new AbortController().signal, {
      now: () => 0,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: vi.fn(),
    });

    await expect(promise).rejects.toBe(failure);
    expect(frames).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run timeline tests to verify they fail**

Run: `npm run test:unit -- tests/unit/timeline.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/timeline'`.

- [ ] **Step 7: Implement one cancellable requestAnimationFrame loop**

Create `src/transition/timeline.ts`:

```ts
export interface FrameClock {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const browserClock: FrameClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export function animateProgress(
  from: number,
  to: number,
  durationMs: number,
  onFrame: (progress: number) => void,
  signal: AbortSignal,
  clock: FrameClock = browserClock,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = clock.now();
    let frameHandle = 0;
    let settled = false;

    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const settleFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      clock.cancelFrame(frameHandle);
      cleanup();
      reject(error);
    };
    const settleAbort = () => {
      if (settled) return;
      settled = true;
      clock.cancelFrame(frameHandle);
      cleanup();
      reject(new DOMException('Animation aborted', 'AbortError'));
    };
    const onAbort = () => settleAbort();
    const frame = (timestamp: number) => {
      if (signal.aborted) {
        settleAbort();
        return;
      }
      const elapsed = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));
      try {
        onFrame(from + (to - from) * elapsed);
      } catch (error) {
        settleFailure(error);
        return;
      }
      if (elapsed === 1) {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      frameHandle = clock.requestFrame(frame);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    try {
      onFrame(from);
    } catch (error) {
      settleFailure(error);
      return;
    }
    frameHandle = clock.requestFrame(frame);
  });
}
```

- [ ] **Step 8: Run motion tests and commit**

Run: `npm run test:unit -- tests/unit/motion-profile.test.ts tests/unit/timeline.test.ts`

Expected: 5 tests PASS.

```bash
git add src/transition/motion-profile.ts src/transition/timeline.ts tests/unit/motion-profile.test.ts tests/unit/timeline.test.ts
git commit -m "feat: add motion profile and frame timeline"
```

### Task 5: Select Full Motion and Capture a Bounded Texture

**Files:**
- Create: `src/transition/capabilities.ts`
- Create: `src/transition/capture.ts`
- Test: `tests/unit/capabilities.test.ts`
- Test: `tests/unit/capture.test.ts`

- [ ] **Step 1: Write failing capability-selection tests**

Create `tests/unit/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectMotionMode } from '../../src/transition/capabilities';

describe('selectMotionMode', () => {
  it('selects full motion only when every prerequisite passes', () => {
    expect(selectMotionMode({ reducedMotion: false, webglAvailable: true, captureAvailable: true })).toBe('full');
  });

  it.each([
    { reducedMotion: true, webglAvailable: true, captureAvailable: true },
    { reducedMotion: false, webglAvailable: false, captureAvailable: true },
    { reducedMotion: false, webglAvailable: true, captureAvailable: false },
  ])('selects fallback for $reducedMotion/$webglAvailable/$captureAvailable', (prerequisites) => {
    expect(selectMotionMode(prerequisites)).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run capability tests to verify they fail**

Run: `npm run test:unit -- tests/unit/capabilities.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/capabilities'`.

- [ ] **Step 3: Implement explicit prerequisite checks**

Create `src/transition/capabilities.ts`:

```ts
import type { FullMotionPrerequisites, MotionMode } from './types';

export function hasWebGl(documentRef: Document = document): boolean {
  const canvas = documentRef.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}

export function selectMotionMode(prerequisites: FullMotionPrerequisites): MotionMode {
  return !prerequisites.reducedMotion && prerequisites.webglAvailable && prerequisites.captureAvailable
    ? 'full'
    : 'fallback';
}

export function browserMotionMode(): MotionMode {
  return selectMotionMode({
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    webglAvailable: hasWebGl(),
    captureAvailable: typeof HTMLCanvasElement !== 'undefined',
  });
}
```

- [ ] **Step 4: Run capability tests**

Run: `npm run test:unit -- tests/unit/capabilities.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Write failing capture-limit and failure tests**

Create `tests/unit/capture.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { captureElement, textureCaptureOptions } from '../../src/transition/capture';
import { defaultMotionProfile } from '../../src/transition/motion-profile';

describe('texture capture', () => {
  it('caps DPR and total texture pixels', () => {
    const options = textureCaptureOptions(1800, 1200, 3, defaultMotionProfile);
    expect(options.pixelRatio).toBeLessThanOrEqual(2);
    expect(options.width * options.height * options.pixelRatio ** 2).toBeLessThanOrEqual(defaultMotionProfile.maxTexturePixels);
  });

  it('passes bounded dimensions to html-to-image', async () => {
    const element = document.createElement('article');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    });
    const canvas = document.createElement('canvas');
    const toCanvas = vi.fn().mockResolvedValue(canvas);

    await expect(captureElement(element, defaultMotionProfile, toCanvas, 3)).resolves.toBe(canvas);
    expect(toCanvas).toHaveBeenCalledWith(element, expect.objectContaining({ pixelRatio: 2 }));
  });

  it('propagates capture failure', async () => {
    const element = document.createElement('article');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({}),
    });
    const failure = new Error('tainted source');

    await expect(captureElement(element, defaultMotionProfile, vi.fn().mockRejectedValue(failure), 1)).rejects.toBe(failure);
  });
});
```

- [ ] **Step 6: Run capture tests to verify they fail**

Run: `npm run test:unit -- tests/unit/capture.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/capture'`.

- [ ] **Step 7: Implement bounded capture without swallowing failures**

Create `src/transition/capture.ts`:

```ts
import { toCanvas as htmlToCanvas } from 'html-to-image';
import type { CaptureOptions, MotionProfile } from './types';

type ToCanvas = (
  element: HTMLElement,
  options: {
    pixelRatio: number;
    width: number;
    height: number;
    cacheBust: boolean;
  },
) => Promise<HTMLCanvasElement>;

export function textureCaptureOptions(
  width: number,
  height: number,
  devicePixelRatio: number,
  profile: MotionProfile,
): CaptureOptions {
  const requestedDpr = Math.min(devicePixelRatio, profile.maxTextureDpr);
  const requestedPixels = width * height * requestedDpr * requestedDpr;
  const pixelScale = requestedPixels > profile.maxTexturePixels
    ? Math.sqrt(profile.maxTexturePixels / requestedPixels)
    : 1;
  const pixelRatio = requestedDpr * pixelScale;
  return {
    pixelRatio,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export async function captureElement(
  element: HTMLElement,
  profile: MotionProfile,
  toCanvas: ToCanvas = htmlToCanvas,
  devicePixelRatio: number = window.devicePixelRatio,
): Promise<HTMLCanvasElement> {
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Cannot capture an element with empty bounds');
  }
  const options = textureCaptureOptions(bounds.width, bounds.height, devicePixelRatio, profile);
  return toCanvas(element, {
    ...options,
    cacheBust: true,
  });
}
```

- [ ] **Step 8: Run capture/capability tests and commit**

Run: `npm run test:unit -- tests/unit/capabilities.test.ts tests/unit/capture.test.ts`

Expected: 7 tests PASS.

```bash
git add src/transition/capabilities.ts src/transition/capture.ts tests/unit/capabilities.test.ts tests/unit/capture.test.ts
git commit -m "feat: gate full motion and bound texture capture"
```

### Task 6: Render the Disposable Paper Mesh

**Files:**
- Create: `src/transition/paper-shaders.ts`
- Create: `src/transition/paper-turn-renderer.ts`
- Test: `tests/unit/paper-turn-renderer.test.ts`

- [ ] **Step 1: Write the failing indexed-mesh test**

Create `tests/unit/paper-turn-renderer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMeshIndices, buildUvs } from '../../src/transition/paper-turn-renderer';

describe('paper mesh buffers', () => {
  it('creates two triangles per cell for a 20x14 mesh', () => {
    const indices = buildMeshIndices(20, 14);
    expect(indices).toHaveLength(20 * 14 * 6);
    expect(Math.max(...indices)).toBe((20 + 1) * (14 + 1) - 1);
  });

  it('creates normalized UVs for every vertex', () => {
    const uvs = buildUvs(2, 1);
    expect(Array.from(uvs)).toEqual([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]);
  });
});
```

- [ ] **Step 2: Run the renderer buffer test to verify it fails**

Run: `npm run test:unit -- tests/unit/paper-turn-renderer.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/paper-turn-renderer'`.

- [ ] **Step 3: Add focused front/reverse-face shaders**

Create `src/transition/paper-shaders.ts`:

```ts
export const paperVertexShader = `
  attribute float shade;
  varying vec2 vUv;
  varying float vShade;

  void main() {
    vUv = uv;
    vShade = shade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const paperFragmentShader = `
  uniform sampler2D paperTexture;
  uniform float shadowStrength;
  varying vec2 vUv;
  varying float vShade;

  void main() {
    vec4 front = texture2D(paperTexture, vUv);
    vec3 reverse = mix(vec3(0.86, 0.87, 0.89), front.rgb, 0.2);
    float highlight = 0.78 + vShade * 0.32;
    vec3 face = gl_FrontFacing ? front.rgb : reverse;
    float reverseShadow = gl_FrontFacing ? 0.0 : shadowStrength * 0.35;
    gl_FragColor = vec4(face * highlight * (1.0 - reverseShadow), front.a);
  }
`;
```

- [ ] **Step 4: Implement the short-lived Three.js renderer**

Create `src/transition/paper-turn-renderer.ts`:

```ts
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { buildPaperFrame } from './geometry';
import { paperFragmentShader, paperVertexShader } from './paper-shaders';
import type { PaperFrame, PaperRenderer, RendererInput } from './types';

export function buildMeshIndices(columns: number, rows: number): number[] {
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * (columns + 1) + column;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }
  return indices;
}

export function buildUvs(columns: number, rows: number): Float32Array {
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const index = row * (columns + 1) + column;
      uvs[index * 2] = column / columns;
      uvs[index * 2 + 1] = row / rows;
    }
  }
  return uvs;
}

export class PaperTurnRenderer implements PaperRenderer {
  private readonly overlay: HTMLDivElement;
  private readonly webgl: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly geometry = new BufferGeometry();
  private readonly texture: CanvasTexture;
  private readonly material: ShaderMaterial;
  private readonly paper: Mesh;
  private readonly shadow: Mesh;
  private disposed = false;

  constructor(private readonly input: RendererInput, documentRef: Document = document) {
    const { meshColumns, meshRows, maxTextureDpr, shadowStrength } = input.profile;
    const vertexCount = (meshColumns + 1) * (meshRows + 1);
    this.overlay = documentRef.createElement('div');
    this.overlay.className = 'paper-turn-overlay';
    this.overlay.dataset.meshVertices = String(vertexCount);

    this.webgl = new WebGLRenderer({ alpha: true, antialias: false });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, maxTextureDpr));
    this.webgl.setSize(input.destinationRect.width, input.destinationRect.height, false);
    this.overlay.append(this.webgl.domElement);
    documentRef.body.append(this.overlay);

    this.camera = new OrthographicCamera(
      input.destinationRect.left,
      input.destinationRect.left + input.destinationRect.width,
      input.destinationRect.top,
      input.destinationRect.top + input.destinationRect.height,
      -1000,
      1000,
    );
    this.camera.position.z = 500;

    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(buildUvs(meshColumns, meshRows), 2));
    this.geometry.setAttribute('shade', new BufferAttribute(new Float32Array(vertexCount), 1));
    this.geometry.setIndex(buildMeshIndices(meshColumns, meshRows));

    this.texture = new CanvasTexture(input.texture);
    this.material = new ShaderMaterial({
      uniforms: {
        paperTexture: { value: this.texture },
        shadowStrength: { value: shadowStrength },
      },
      vertexShader: paperVertexShader,
      fragmentShader: paperFragmentShader,
      side: DoubleSide,
      transparent: true,
    });
    this.paper = new Mesh(this.geometry, this.material);

    const shadowMaterial = new MeshBasicMaterial({
      color: 0x000000,
      opacity: shadowStrength,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.shadow = new Mesh(this.geometry, shadowMaterial);
    this.shadow.position.set(10, 14, -12);
    this.scene.add(this.shadow, this.paper);
  }

  render(progress: number): PaperFrame {
    if (this.disposed) {
      throw new Error('PaperTurnRenderer cannot render after disposal');
    }
    const frame = buildPaperFrame(
      this.input.sourceRect,
      this.input.destinationRect,
      this.input.grabbedCorner,
      progress,
      this.input.profile,
    );
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    const shade = this.geometry.getAttribute('shade') as BufferAttribute;
    position.copyArray(frame.positions);
    shade.copyArray(frame.shade);
    position.needsUpdate = true;
    shade.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.overlay.dataset.progress = progress.toFixed(3);
    this.webgl.render(this.scene, this.camera);
    return frame;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.paper, this.shadow);
    this.geometry.dispose();
    this.material.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.webgl.dispose();
    this.webgl.forceContextLoss();
    this.overlay.remove();
  }
}
```

- [ ] **Step 5: Run renderer buffer tests and the TypeScript build**

Run: `npm run test:unit -- tests/unit/paper-turn-renderer.test.ts && npm run build`

Expected: 2 tests PASS; TypeScript and Vite build exit 0.

- [ ] **Step 6: Commit the paper renderer**

```bash
git add src/transition/paper-shaders.ts src/transition/paper-turn-renderer.ts tests/unit/paper-turn-renderer.test.ts
git commit -m "feat: render disposable paper mesh"
```

### Task 7: Encapsulate DOM State and the Opacity/Scale Fallback

**Files:**
- Create: `src/transition/dom-transition-view.ts`
- Create: `src/transition/fallback-transition.ts`
- Test: `tests/unit/dom-transition-view.test.ts`
- Test: `tests/unit/fallback-transition.test.ts`

- [ ] **Step 1: Write failing DOM lifecycle tests**

Create `tests/unit/dom-transition-view.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DomTransitionView } from '../../src/transition/dom-transition-view';

function fixture() {
  document.body.innerHTML = `
    <section data-list><button data-source-id="one">One</button><div data-fallback tabindex="-1"></div></section>
    <article data-detail hidden><h2 tabindex="-1">Detail</h2></article>
  `;
  const list = document.querySelector<HTMLElement>('[data-list]')!;
  const detail = document.querySelector<HTMLElement>('[data-detail]')!;
  const heading = document.querySelector<HTMLElement>('h2')!;
  const fallback = document.querySelector<HTMLElement>('[data-fallback]')!;
  const renderDetail = vi.fn();
  return {
    list,
    detail,
    heading,
    fallback,
    renderDetail,
    view: new DomTransitionView({ list, detail, heading, fallback, renderDetail }),
  };
}

describe('DomTransitionView', () => {
  it('prepares inert detail and controls busy surfaces', () => {
    const { view, list, detail, renderDetail } = fixture();
    view.prepareDetail('one');
    view.setDetailVisible(true);
    view.setDetailInert(true);
    view.setBusy(true);

    expect(renderDetail).toHaveBeenCalledWith('one');
    expect(detail.hidden).toBe(false);
    expect(detail.inert).toBe(true);
    expect(list.inert).toBe(true);
    expect(list.getAttribute('aria-busy')).toBe('true');
  });

  it('hides only the selected source', () => {
    const { view } = fixture();
    const source = view.resolveSource('one')!;
    view.setSourceHidden(source, true);
    expect(source.dataset.transitionHidden).toBe('true');
    view.setSourceHidden(source, false);
    expect(source.hasAttribute('data-transition-hidden')).toBe(false);
  });

  it('freezes and restores the exact scroll position', () => {
    const { view } = fixture();
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(275);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    view.freezeScroll();
    expect(document.body.style.top).toBe('-275px');
    view.restoreScroll();
    expect(scrollTo).toHaveBeenCalledWith(0, 275);
  });

  it('focuses the list fallback when requested', () => {
    const { view, fallback } = fixture();
    const focus = vi.spyOn(fallback, 'focus');
    view.focusListFallback();
    expect(focus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the DOM lifecycle tests to verify they fail**

Run: `npm run test:unit -- tests/unit/dom-transition-view.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/dom-transition-view'`.

- [ ] **Step 3: Implement the DOM transition boundary**

Create `src/transition/dom-transition-view.ts`:

```ts
import type { Rect, TransitionView } from './types';

interface DomTransitionViewInput {
  list: HTMLElement;
  detail: HTMLElement;
  heading: HTMLElement;
  fallback: HTMLElement;
  renderDetail(sourceId: string): void;
}

function rectFrom(bounds: DOMRect): Rect {
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

export class DomTransitionView implements TransitionView {
  private frozenScrollY: number | null = null;

  constructor(private readonly input: DomTransitionViewInput) {}

  prepareDetail(sourceId: string): void {
    this.input.renderDetail(sourceId);
  }

  measureDestination(): Rect {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  resolveSource(sourceId: string): HTMLElement | null {
    return this.input.list.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
  }

  measureSource(source: HTMLElement): Rect {
    return rectFrom(source.getBoundingClientRect());
  }

  setDetailClip(clipPath: string): void {
    this.input.detail.style.clipPath = clipPath;
  }

  setSourceHidden(source: HTMLElement, hidden: boolean): void {
    if (hidden) {
      source.dataset.transitionHidden = 'true';
    } else {
      delete source.dataset.transitionHidden;
    }
  }

  setListVisible(visible: boolean): void {
    this.input.list.hidden = !visible;
  }

  setDetailVisible(visible: boolean): void {
    this.input.detail.hidden = !visible;
  }

  setDetailInert(inert: boolean): void {
    this.input.detail.inert = inert;
  }

  setBusy(busy: boolean): void {
    this.input.list.inert = busy;
    this.input.list.setAttribute('aria-busy', String(busy));
    this.input.detail.dataset.transitionBusy = String(busy);
  }

  freezeScroll(): void {
    if (this.frozenScrollY !== null) return;
    this.frozenScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.inset = `${-this.frozenScrollY}px 0 auto 0`;
    document.body.style.width = '100%';
  }

  restoreScroll(): void {
    if (this.frozenScrollY === null) return;
    const scrollY = this.frozenScrollY;
    this.frozenScrollY = null;
    document.body.style.position = '';
    document.body.style.inset = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
  }

  focusDetailHeading(): void {
    this.input.heading.focus();
  }

  focusListFallback(): void {
    this.input.fallback.focus();
  }
}
```

- [ ] **Step 4: Run DOM lifecycle tests**

Run: `npm run test:unit -- tests/unit/dom-transition-view.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Write the failing fallback animation tests**

Create `tests/unit/fallback-transition.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFallbackRunner } from '../../src/transition/fallback-transition';

describe('createFallbackRunner', () => {
  it.each([
    ['open', ['0.35', '1'], ['scale(0.985)', 'scale(1)']],
    ['close', ['1', '0'], ['scale(1)', 'scale(0.985)']],
  ] as const)('animates %s opacity and scale', async (direction, opacity, transform) => {
    const element = document.createElement('article');
    const finished = Promise.resolve();
    const animate = vi.fn().mockReturnValue({ finished, cancel: vi.fn() });
    Object.defineProperty(element, 'animate', { value: animate });

    await createFallbackRunner(element)(direction, 200, new AbortController().signal);

    expect(animate).toHaveBeenCalledWith(
      { opacity, transform },
      { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },
    );
  });

  it('cancels the Web Animation when aborted', async () => {
    const element = document.createElement('article');
    const controller = new AbortController();
    const cancel = vi.fn();
    Object.defineProperty(element, 'animate', {
      value: vi.fn().mockReturnValue({ finished: new Promise(() => undefined), cancel }),
    });
    const promise = createFallbackRunner(element)('open', 200, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run fallback tests to verify they fail**

Run: `npm run test:unit -- tests/unit/fallback-transition.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/fallback-transition'`.

- [ ] **Step 7: Implement the 200 ms fallback**

Create `src/transition/fallback-transition.ts`:

```ts
export type FallbackRunner = (
  direction: 'open' | 'close',
  durationMs: number,
  signal: AbortSignal,
) => Promise<void>;

export function createFallbackRunner(element: HTMLElement): FallbackRunner {
  return async (direction, durationMs, signal) => {
    const opening = direction === 'open';
    const animation = element.animate(
      {
        opacity: opening ? ['0.35', '1'] : ['1', '0'],
        transform: opening ? ['scale(0.985)', 'scale(1)'] : ['scale(1)', 'scale(0.985)'],
      },
      {
        duration: durationMs,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );

    const abort = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        animation.cancel();
        reject(new DOMException('Fallback aborted', 'AbortError'));
      }, { once: true });
    });
    await Promise.race([animation.finished, abort]);
  };
}
```

- [ ] **Step 8: Run DOM/fallback tests and commit**

Run: `npm run test:unit -- tests/unit/dom-transition-view.test.ts tests/unit/fallback-transition.test.ts`

Expected: 7 tests PASS.

```bash
git add src/transition/dom-transition-view.ts src/transition/fallback-transition.ts tests/unit/dom-transition-view.test.ts tests/unit/fallback-transition.test.ts
git commit -m "feat: manage DOM transition and fallback motion"
```

### Task 8: Orchestrate Opening, Closing, Failures, and Interruption

**Files:**
- Create: `src/transition/transition-coordinator.ts`
- Test: `tests/unit/transition-coordinator.test.ts`

- [ ] **Step 1: Write the failing coordinator state and symmetry tests**

Create `tests/unit/transition-coordinator.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMotionProfile } from '../../src/transition/motion-profile';
import { TransitionCoordinator } from '../../src/transition/transition-coordinator';
import type {
  PaperRenderer,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionView,
} from '../../src/transition/types';

function harness(options: { mode?: 'full' | 'fallback'; captureFails?: boolean; sourceExists?: boolean } = {}) {
  const source = document.createElement('button');
  source.dataset.sourceId = 'one';
  document.body.append(source);
  const trigger = source;
  const rendered: number[] = [];
  const renderer: PaperRenderer = {
    render: vi.fn((progress) => {
      rendered.push(progress);
      return {
        positions: new Float32Array(),
        shade: new Float32Array(),
        revealClipPath: `polygon(${progress * 100}% 0%, 100% 100%, 0% 100%)`,
      };
    }),
    dispose: vi.fn(),
  };
  const view: TransitionView = {
    prepareDetail: vi.fn(),
    measureDestination: vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 700 })),
    resolveSource: vi.fn(() => options.sourceExists === false ? null : source),
    measureSource: vi.fn(() => ({ left: 100, top: 80, width: 240, height: 160 })),
    setDetailClip: vi.fn(),
    setSourceHidden: vi.fn(),
    setListVisible: vi.fn(),
    setDetailVisible: vi.fn(),
    setDetailInert: vi.fn(),
    setBusy: vi.fn(),
    freezeScroll: vi.fn(),
    restoreScroll: vi.fn(),
    focusDetailHeading: vi.fn(),
    focusListFallback: vi.fn(),
  };
  const dependencies: TransitionDependencies = {
    profile: defaultMotionProfile,
    selectMotionMode: vi.fn(() => options.mode ?? 'full'),
    capture: options.captureFails
      ? vi.fn().mockRejectedValue(new Error('capture failed'))
      : vi.fn().mockResolvedValue(document.createElement('canvas')),
    createRenderer: vi.fn(() => renderer),
    runFallback: vi.fn().mockResolvedValue(undefined),
    animate: vi.fn(async (from, to, _duration, onFrame, signal) => {
      onFrame(from);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      onFrame((from + to) / 2);
      onFrame(to);
    }),
  };
  const coordinator = new TransitionCoordinator(view, dependencies);
  const request: TransitionOpenRequest = { sourceId: 'one', grabbedCorner: 'top-right', trigger };
  return { coordinator, dependencies, renderer, rendered, source, trigger, view, request };
}

describe('TransitionCoordinator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens through preparing/opening and settles as active DOM', async () => {
    const { coordinator, view, request, renderer } = harness();
    const states: string[] = [];
    coordinator.addEventListener('statechange', () => states.push(coordinator.state));

    await coordinator.open(request);

    expect(states).toEqual(['preparing', 'opening', 'open']);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(false);
    expect(view.setListVisible).toHaveBeenLastCalledWith(false);
    expect(view.focusDetailHeading).toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalled();
  });

  it('rejects overlapping open requests', async () => {
    const { coordinator, dependencies, request } = harness();
    let release: (() => void) | undefined;
    dependencies.animate = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = coordinator.open(request);
    await Promise.resolve();

    await expect(coordinator.open(request)).rejects.toThrow('Cannot open while transition state is opening');
    release?.();
    await first;
  });

  it('closes by rendering the same timeline in reverse and restores source focus', async () => {
    const { coordinator, rendered, request, source, view } = harness();
    const focus = vi.spyOn(source, 'focus');
    await coordinator.open(request);
    rendered.length = 0;
    await coordinator.close();

    expect(rendered).toEqual([1, 0.5, 0]);
    expect(coordinator.state).toBe('idle');
    expect(view.restoreScroll).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('remeasures the current source-card bounds before closing', async () => {
    const { coordinator, dependencies, request, view } = harness();
    await coordinator.open(request);
    vi.mocked(view.measureSource).mockReturnValue({ left: 40, top: 30, width: 320, height: 180 });

    await coordinator.close();

    expect(dependencies.createRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceRect: { left: 40, top: 30, width: 320, height: 180 },
    }));
  });

  it('uses fallback after a capture failure and still reaches open', async () => {
    const { coordinator, dependencies, request } = harness({ captureFails: true });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await coordinator.open(request);

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
    expect(report).toHaveBeenCalledWith('Paper-turn full motion failed; using fallback.', expect.any(Error));
  });

  it('uses fallback after a renderer frame failure and disposes the overlay', async () => {
    const { coordinator, dependencies, renderer, request } = harness();
    vi.mocked(renderer.render).mockImplementation(() => {
      throw new Error('shader failed');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(renderer.dispose).toHaveBeenCalled();
    expect(coordinator.state).toBe('open');
  });

  it('focuses the list fallback when the source no longer exists', async () => {
    const { coordinator, request, view } = harness();
    await coordinator.open(request);
    vi.mocked(view.resolveSource).mockReturnValue(null);
    await coordinator.close();
    expect(view.focusListFallback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the coordinator tests to verify they fail**

Run: `npm run test:unit -- tests/unit/transition-coordinator.test.ts`

Expected: FAIL with `Cannot find module '../../src/transition/transition-coordinator'`.

- [ ] **Step 3: Implement the coordinator state machine and stable cleanup**

Create `src/transition/transition-coordinator.ts`:

```ts
import type {
  MotionMode,
  PaperRenderer,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionState,
  TransitionView,
} from './types';

type Endpoint = 'idle' | 'open';

interface ActiveTransition {
  request: TransitionOpenRequest;
  source: HTMLElement | null;
  renderer: PaperRenderer | null;
  controller: AbortController | null;
  progress: number;
  requestedEndpoint: Endpoint;
  interruption: 'escape' | 'resize' | null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class TransitionCoordinator extends EventTarget {
  state: TransitionState = 'idle';
  private active: ActiveTransition | null = null;

  constructor(
    private readonly view: TransitionView,
    private readonly dependencies: TransitionDependencies,
  ) {
    super();
  }

  async open(request: TransitionOpenRequest): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot open while transition state is ${this.state}`);
    }
    this.setState('preparing');
    this.view.setBusy(true);
    this.view.freezeScroll();
    this.view.prepareDetail(request.sourceId);
    this.view.setDetailVisible(true);
    this.view.setDetailInert(true);
    const source = this.view.resolveSource(request.sourceId);
    if (!source) {
      this.view.setBusy(false);
      this.view.setDetailVisible(false);
      this.view.restoreScroll();
      this.setState('idle');
      throw new Error(`Source card no longer exists: ${request.sourceId}`);
    }
    this.active = {
      request,
      source,
      renderer: null,
      controller: null,
      progress: 0,
      requestedEndpoint: 'open',
      interruption: null,
    };

    await this.runTransition('open', this.dependencies.selectMotionMode());
  }

  async close(): Promise<void> {
    if (this.state !== 'open' || !this.active) {
      throw new Error(`Cannot close while transition state is ${this.state}`);
    }
    this.active.requestedEndpoint = 'idle';
    this.active.source = this.view.resolveSource(this.active.request.sourceId);
    this.view.setBusy(true);
    this.view.setDetailInert(true);
    this.view.setListVisible(true);
    await this.runTransition('close', this.dependencies.selectMotionMode());
  }

  cancel(): void {
    if (!this.active || (this.state !== 'opening' && this.state !== 'closing')) return;
    this.active.interruption = 'escape';
    this.active.requestedEndpoint = this.active.progress >= 0.5 ? 'open' : 'idle';
    this.active.controller?.abort();
  }

  handleViewportChange(): void {
    if (!this.active || (this.state !== 'opening' && this.state !== 'closing')) return;
    this.active.interruption = 'resize';
    this.active.controller?.abort();
  }

  private async runTransition(direction: 'open' | 'close', preferredMode: MotionMode): Promise<void> {
    if (!this.active) throw new Error('Missing active transition');
    const targetState: TransitionState = direction === 'open' ? 'opening' : 'closing';
    this.setState(targetState);

    if (preferredMode === 'fallback' || !this.active.source) {
      await this.runFallbackTo(this.active.requestedEndpoint);
      return;
    }

    try {
      await this.runFull(direction);
      this.settle(this.active.requestedEndpoint);
    } catch (error) {
      const interruption = this.active.interruption;
      this.disposeRenderer();
      this.active.controller = null;
      if (!isAbortError(error)) {
        console.error('Paper-turn full motion failed; using fallback.', error);
      }
      if (isAbortError(error) && !interruption) {
        throw error;
      }
      await this.runFallbackTo(this.active.requestedEndpoint);
    }
  }

  private async runFull(direction: 'open' | 'close'): Promise<void> {
    if (!this.active?.source) throw new Error('Full motion requires a source card');
    const controller = new AbortController();
    this.active.controller = controller;
    const sourceRect = this.view.measureSource(this.active.source);
    const destinationRect = this.view.measureDestination();
    const texture = await this.dependencies.capture(this.active.source, this.dependencies.profile);
    controller.signal.throwIfAborted();
    this.active.renderer = this.dependencies.createRenderer({
      sourceRect,
      destinationRect,
      grabbedCorner: this.active.request.grabbedCorner,
      texture,
      profile: this.dependencies.profile,
    });
    this.view.setSourceHidden(this.active.source, true);
    const from = direction === 'open' ? 0 : 1;
    const to = direction === 'open' ? 1 : 0;
    await this.dependencies.animate(
      from,
      to,
      this.dependencies.profile.durationMs,
      (progress) => {
        if (!this.active?.renderer) throw new Error('Renderer disappeared during animation');
        this.active.progress = progress;
        const frame = this.active.renderer.render(progress);
        this.view.setDetailClip(frame.revealClipPath);
      },
      controller.signal,
    );
  }

  private async runFallbackTo(endpoint: Endpoint): Promise<void> {
    if (!this.active) throw new Error('Missing active transition');
    this.disposeRenderer();
    if (this.active.source) {
      this.view.setSourceHidden(this.active.source, false);
    }
    const controller = new AbortController();
    this.active.controller = controller;
    if (endpoint === 'open') {
      this.view.setDetailClip('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)');
    }
    try {
      await this.dependencies.runFallback(
        endpoint === 'open' ? 'open' : 'close',
        this.dependencies.profile.fallbackDurationMs,
        controller.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Paper-turn fallback failed; settling to a stable endpoint.', error);
      }
    }
    this.settle(this.active.requestedEndpoint);
  }

  private settle(endpoint: Endpoint): void {
    if (!this.active) throw new Error('Missing active transition');
    const source = this.active.source;
    this.disposeRenderer();
    if (source) {
      this.view.setSourceHidden(source, false);
    }
    this.active.controller = null;
    this.active.interruption = null;
    this.view.setBusy(false);

    if (endpoint === 'open') {
      this.view.setDetailClip('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)');
      this.view.setListVisible(false);
      this.view.setDetailVisible(true);
      this.view.setDetailInert(false);
      this.setState('open');
      this.view.focusDetailHeading();
      return;
    }

    this.view.setDetailInert(true);
    this.view.setDetailVisible(false);
    this.view.setListVisible(true);
    this.view.restoreScroll();
    this.setState('idle');
    if (source?.isConnected) {
      source.focus();
    } else {
      this.view.focusListFallback();
    }
    this.active = null;
  }

  private disposeRenderer(): void {
    this.active?.renderer?.dispose();
    if (this.active) this.active.renderer = null;
  }

  private setState(state: TransitionState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
```

- [ ] **Step 4: Run coordinator tests**

Run: `npm run test:unit -- tests/unit/transition-coordinator.test.ts`

Expected: 7 tests PASS.

- [ ] **Step 5: Add failing Escape and resize interruption tests**

Append to the `describe` block in `tests/unit/transition-coordinator.test.ts`:

```ts
  it('Escape settles to the nearest endpoint and never leaves a half-state', async () => {
    const { coordinator, dependencies, request } = harness();
    dependencies.animate = vi.fn(async (_from, _to, _duration, onFrame, signal) => {
      onFrame(0.2);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const opening = coordinator.open(request);
    await Promise.resolve();
    await Promise.resolve();
    coordinator.cancel();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('close', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('idle');
  });

  it('resize keeps the requested endpoint but switches to fallback', async () => {
    const { coordinator, dependencies, request } = harness();
    dependencies.animate = vi.fn(async (_from, _to, _duration, onFrame, signal) => {
      onFrame(0.2);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const opening = coordinator.open(request);
    await Promise.resolve();
    await Promise.resolve();
    coordinator.handleViewportChange();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });
```

- [ ] **Step 6: Run interruption tests and commit**

Run: `npm run test:unit -- tests/unit/transition-coordinator.test.ts`

Expected: 9 tests PASS.

```bash
git add src/transition/transition-coordinator.ts tests/unit/transition-coordinator.test.ts
git commit -m "feat: coordinate reversible paper transitions"
```

### Task 9: Wire the Browser Demo

**Files:**
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Test: `tests/e2e/interaction.spec.ts`

- [ ] **Step 1: Write the first failing browser interaction test**

Create `tests/e2e/interaction.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npx playwright install chromium webkit && npm run test:e2e -- --project=chromium-desktop`

Expected: browser installation succeeds, then FAIL because clicking a card does not open the detail surface.

- [ ] **Step 3: Replace the entrypoint with complete transition wiring**

Replace `src/main.ts` with:

```ts
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/card/sp-card.js';
import '@spectrum-web-components/button/sp-button.js';
import './styles.css';
import { createDemoApp } from './app';
import { browserMotionMode } from './transition/capabilities';
import { captureElement } from './transition/capture';
import { DomTransitionView } from './transition/dom-transition-view';
import { createFallbackRunner } from './transition/fallback-transition';
import { defaultMotionProfile } from './transition/motion-profile';
import { PaperTurnRenderer } from './transition/paper-turn-renderer';
import { animateProgress } from './transition/timeline';
import { TransitionCoordinator } from './transition/transition-coordinator';
import type { Corner, MotionProfile } from './transition/types';

declare global {
  interface Window {
    __paperTurn: {
      coordinator: TransitionCoordinator;
      profile: MotionProfile;
    };
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

const app = createDemoApp(root);
const query = new URLSearchParams(window.location.search);
const requestedDuration = Number(query.get('duration'));
const profile: MotionProfile = {
  ...defaultMotionProfile,
  durationMs: Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : defaultMotionProfile.durationMs,
};
const view = new DomTransitionView({
  list: app.listSurface,
  detail: app.detailSurface,
  heading: app.detailHeading,
  fallback: app.listFocusFallback,
  renderDetail: app.renderDetail,
});
const coordinator = new TransitionCoordinator(view, {
  profile,
  selectMotionMode: () => query.has('fallback') ? 'fallback' : browserMotionMode(),
  capture: captureElement,
  createRenderer: (input) => new PaperTurnRenderer(input),
  runFallback: createFallbackRunner(app.detailSurface),
  animate: animateProgress,
});

root.querySelectorAll<HTMLElement>('[data-card-trigger]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const sourceId = trigger.dataset.sourceId;
    if (!sourceId) throw new Error('Card trigger is missing data-source-id');
    void coordinator.open({
      sourceId,
      grabbedCorner: (trigger.dataset.grabbedCorner as Corner | undefined) ?? 'top-right',
      trigger,
    });
  });
});
app.closeButton.addEventListener('click', () => void coordinator.close());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') coordinator.cancel();
});
window.addEventListener('resize', () => coordinator.handleViewportChange());
window.addEventListener('orientationchange', () => coordinator.handleViewportChange());
coordinator.addEventListener('statechange', () => {
  root.dataset.transitionState = coordinator.state;
});
root.dataset.transitionState = coordinator.state;
window.__paperTurn = { coordinator, profile };
```

- [ ] **Step 4: Add state and mobile performance styling**

Append to `src/styles.css`:

```css
#app[data-transition-state='preparing'],
#app[data-transition-state='opening'],
#app[data-transition-state='closing'] {
  cursor: progress;
}

[data-transition-busy='true'] {
  pointer-events: none;
}

.paper-turn-overlay canvas {
  display: block;
  width: 100%;
  height: 100%;
}

@media (max-width: 600px) {
  .list-surface,
  .detail-surface {
    padding: 20px;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }

  sp-card {
    min-height: 280px;
  }
}
```

- [ ] **Step 5: Run the first browser interaction test**

Run: `npm run test:e2e -- --project=chromium-desktop --grep "mouse opening"`

Expected: 1 test PASS; the overlay is absent at both settled endpoints.

- [ ] **Step 6: Commit the wired demo**

```bash
git add src/main.ts src/styles.css tests/e2e/interaction.spec.ts
git commit -m "feat: wire paper-turn browser interaction"
```

### Task 10: Cover Keyboard, Touch, Escape, Resize, Multiple Cards, and Fallback

**Files:**
- Modify: `tests/e2e/interaction.spec.ts`

- [ ] **Step 1: Add complete browser interaction coverage**

Append to `tests/e2e/interaction.spec.ts`:

```ts
test('keyboard opening moves focus to detail and closing restores it', async ({ page }) => {
  await page.goto('/?duration=120');
  const secondCard = page.locator('[data-card-trigger]').nth(1);
  await secondCard.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-detail-heading]')).toHaveText('Workflow patterns');
  await expect(page.locator('[data-detail-heading]')).toBeFocused();
  await page.locator('[data-close-button]').press('Enter');
  await expect(secondCard).toBeFocused();
});

test('touch opens a card on the mobile project', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only touch coverage');
  await page.goto('/?duration=120');
  await page.locator('[data-card-trigger]').nth(2).tap();
  await expect(page.locator('[data-detail-heading]')).toHaveText('Content surfaces');
  await expect(page.locator('[data-detail-surface]')).not.toHaveAttribute('inert', '');
});

test('controls are inert during the turn and Escape returns to the nearest endpoint', async ({ page }) => {
  await page.goto('/?duration=2000');
  const firstCard = page.locator('[data-card-trigger]').first();
  await firstCard.click();
  await expect(page.locator('.paper-turn-overlay')).toBeVisible();
  await expect(page.locator('[data-list-surface]')).toHaveAttribute('inert', '');
  await expect(page.locator('[data-detail-surface]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-detail-surface]')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-transition-state', 'idle');
});

test('Escape during closing returns to the open endpoint when it is still nearest', async ({ page }) => {
  await page.goto('/?duration=120');
  await page.locator('[data-card-trigger]').first().click();
  await expect(page.locator('#app')).toHaveAttribute('data-transition-state', 'open');
  await page.evaluate(() => {
    window.__paperTurn.profile.durationMs = 2000;
  });
  await page.locator('[data-close-button]').click();
  await expect(page.locator('.paper-turn-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-transition-state', 'open');
  await expect(page.locator('[data-detail-heading]')).toBeFocused();
});

test('resize during motion completes opening through fallback', async ({ page }) => {
  await page.goto('/?duration=2000');
  await page.locator('[data-card-trigger]').first().click();
  await expect(page.locator('.paper-turn-overlay')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 640 });
  await expect(page.locator('[data-detail-surface]')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-transition-state', 'open');
  await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
});

test('different cards do not reuse stale texture, content, or focus', async ({ page }) => {
  await page.goto('/?duration=120');
  for (const [index, title] of ['Spectrum foundations', 'Workflow patterns', 'Content surfaces'].entries()) {
    const card = page.locator('[data-card-trigger]').nth(index);
    await card.click();
    await expect(page.locator('[data-detail-heading]')).toHaveText(title);
    await page.locator('[data-close-button]').click();
    await expect(card).toBeFocused();
  }
});

test('reduced motion and explicit capability fallback remain functional', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?duration=2000');
  await page.locator('[data-card-trigger]').first().click();
  await expect(page.locator('[data-detail-surface]')).toBeVisible();
  await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
  await page.goto('/?fallback=1');
  await page.locator('[data-card-trigger]').nth(1).click();
  await expect(page.locator('[data-detail-heading]')).toHaveText('Workflow patterns');
  await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
});

test('full motion keeps the mobile-sized mesh and capped canvas DPR', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'mobile performance contract');
  await page.goto('/?duration=2000');
  await page.locator('[data-card-trigger]').first().click();
  const overlay = page.locator('.paper-turn-overlay');
  await expect(overlay).toHaveAttribute('data-mesh-vertices', '315');
  const dimensions = await overlay.locator('canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth * 2);
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight * 2);
});
```

- [ ] **Step 2: Run interaction coverage on desktop and mobile**

Run: `npm run test:e2e`

Expected: all applicable tests PASS in `chromium-desktop`, `chromium-mobile`, and `webkit-mobile`; touch coverage runs in both mobile projects, and the mesh/DPR contract runs in `chromium-mobile`.

- [ ] **Step 3: Commit browser interaction coverage**

```bash
git add tests/e2e/interaction.spec.ts
git commit -m "test: cover paper-turn browser interactions"
```

### Task 11: Add Deterministic Visual Regression Checkpoints

**Files:**
- Create: `tests/e2e/visual.spec.ts`
- Create: `tests/e2e/visual.spec.ts-snapshots/*.png`

- [ ] **Step 1: Write visual checkpoint tests**

Create `tests/e2e/visual.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('paper-turn visual checkpoints', () => {
  async function waitForProgress(page: import('@playwright/test').Page, minimum: number, maximum: number) {
    await expect.poll(async () => {
      const value = await page.locator('.paper-turn-overlay').getAttribute('data-progress');
      return Number(value);
    }, { intervals: [16], timeout: 3000 }).toBeGreaterThanOrEqual(minimum);
    const progress = Number(await page.locator('.paper-turn-overlay').getAttribute('data-progress'));
    expect(progress).toBeLessThanOrEqual(maximum);
  }

  test('captures start, curl, midpoint, and settled DOM', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'single rendering baseline');
    await page.goto('/?duration=2400');
    await page.locator('[data-card-trigger]').first().click();
    await expect(page.locator('.paper-turn-overlay')).toBeVisible();
    await expect(page).toHaveScreenshot('paper-turn-start.png');

    await waitForProgress(page, 0.46, 0.54);
    await expect(page).toHaveScreenshot('paper-turn-peak-curl.png');

    await waitForProgress(page, 0.58, 0.66);
    await expect(page).toHaveScreenshot('paper-turn-diagonal-midpoint.png');

    await expect(page.locator('#app')).toHaveAttribute('data-transition-state', 'open');
    await expect(page.locator('.paper-turn-overlay')).toHaveCount(0);
    await expect(page).toHaveScreenshot('paper-turn-settled.png');
  });
});
```

- [ ] **Step 2: Generate the four approved baselines**

Run: `npm run test:visual -- --project=chromium-desktop --update-snapshots`

Expected: 1 test PASS and exactly four PNG files are written under `tests/e2e/visual.spec.ts-snapshots/`.

- [ ] **Step 3: Re-run visual tests against the generated baselines**

Run: `npm run test:visual -- --project=chromium-desktop`

Expected: 1 test PASS with no updated or missing snapshots.

- [ ] **Step 4: Commit visual checkpoints**

```bash
git add tests/e2e/visual.spec.ts tests/e2e/visual.spec.ts-snapshots
git commit -m "test: add paper-turn visual checkpoints"
```

### Task 12: Verify the Complete Prototype Against the Specification

**Files:**
- None.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm run test:unit`

Expected: all unit files PASS with zero failed tests.

- [ ] **Step 2: Run strict type-checking and the production build**

Run: `npm run build`

Expected: TypeScript exits 0, Vite emits `dist/`, and the build reports no unresolved imports.

- [ ] **Step 3: Run all desktop and mobile browser tests**

Run: `npx playwright test`

Expected: all applicable interaction and visual tests PASS in their configured projects, with the visual suite skipped only for the non-Chromium baseline project.

- [ ] **Step 4: Inspect settled and transitional DOM invariants**

Run:

```bash
grep -R "requestAnimationFrame" -n src/transition
grep -R "getBoundingClientRect" -n src/transition
grep -R "meshColumns: 20" -n src/transition/motion-profile.ts
```

Expected:

- `requestAnimationFrame` appears only in `src/transition/timeline.ts`.
- `getBoundingClientRect` appears only in `src/transition/capture.ts` and `src/transition/dom-transition-view.ts`, outside the frame callback.
- `meshColumns: 20` appears once in `src/transition/motion-profile.ts`.

- [ ] **Step 5: Manually inspect the four required visual states**

Run: `npm run dev -- --strictPort`

Expected: at `http://127.0.0.1:4173`, the start aligns with the clicked card; peak curl shows curved edges, reverse face, highlights, and shadow; the diagonal midpoint exposes stationary detail DOM beneath the moving fold; the settled page contains no canvas overlay. Closing reverses into the current card bounds.

- [ ] **Step 6: Confirm the final diff contains no incomplete markers or scope expansion**

Run:

```bash
BASE_COMMIT=$(git rev-list --max-parents=0 HEAD)
git diff --check "$BASE_COMMIT"..HEAD
git diff --name-only "$BASE_COMMIT"..HEAD
grep -REn "T[B]D|T[O]DO|F[I]XME|P[L]ACEHOLDER|implement l[a]ter|fill in d[e]tails" src tests package.json *.config.ts || true
```

Expected: `git diff --check` exits 0; changed files are limited to the locked file structure plus the approved spec and plan; the incomplete-marker scan prints no matches.

- [ ] **Step 7: Confirm implementation commits leave a clean worktree**

Run: `git status --short`

Expected: no output. If any verification step fails, stop at that failure and return to the task that owns the failing file rather than masking the failure in a catch-all correction.
