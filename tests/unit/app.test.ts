import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoApp } from '../../src/app';

const stylesPath = resolve(process.cwd(), 'src/styles.css');

describe('createDemoApp', () => {
  it('renders keyboard-operable cards and one hidden inert detail endpoint', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);
    const cardGrid = root.querySelector<HTMLElement>('[data-list-focus-fallback]');

    expect(cardGrid?.tagName).toBe('UL');
    expect(cardGrid?.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(root.querySelectorAll<HTMLButtonElement>('[data-card-trigger]')).toHaveLength(3);
    expect(app.listSurface.getAttribute('aria-busy')).toBe('false');
    expect(app.detailSurface.hidden).toBe(true);
    expect(app.detailSurface.inert).toBe(true);
    expect(app.listFocusFallback.tabIndex).toBe(-1);
  });

  it('renders the requested tile count, up to the sixteen records it has', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root, 16);

    expect(app.tileCount()).toBe(16);
    expect(root.querySelectorAll('[data-card-trigger]')).toHaveLength(16);

    app.setTileCount(1);
    expect(app.tileCount()).toBe(1);
    expect(root.querySelectorAll('[data-card-trigger]')).toHaveLength(1);

    // Out of range is clamped rather than refused, so a stale ?tiles= or a
    // controller bug cannot empty the grid.
    app.setTileCount(0);
    expect(app.tileCount()).toBe(1);
    app.setTileCount(99);
    expect(app.tileCount()).toBe(16);
  });

  it('writes the column count the grid measured into onto the grid element', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root, 16);

    // jsdom reports a zero client width, which is the "no room for even one
    // tile" case: it must fold to a single column rather than divide by zero.
    expect(app.cardGrid.style.getPropertyValue('--grid-columns')).toBe('1');

    Object.defineProperty(app.cardGrid, 'clientWidth', { value: 1152, configurable: true });
    expect(app.refreshLayout()).toEqual({ rowCount: 4, columnCount: 4 });
    expect(app.cardGrid.style.getPropertyValue('--grid-columns')).toBe('4');
  });

  it('labels every tile with the anchor it would be grabbed by, and can hide them', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root, 4);
    const labels = () =>
      [...root.querySelectorAll<HTMLElement>('[data-paper-turn-anchor-label]')].map(
        (label) => label.textContent,
      );

    expect(labels()).toHaveLength(4);
    // Every tile is unmeasurable in jsdom, so the resolver collapses to its
    // single-tile anchor. What matters here is that each label is populated from
    // the resolver at all, which the browser suites then read for real.
    expect(labels().every((text) => text === 'bottom-right')).toBe(true);

    expect(app.anchorLabelsVisible()).toBe(true);
    app.setAnchorLabelsVisible(false);
    expect(app.anchorLabelsVisible()).toBe(false);
    expect(app.cardGrid.dataset.anchorLabels).toBe('false');
  });

  it('keeps the anchor label outside the trigger so it is never captured', () => {
    const root = document.createElement('div');
    createDemoApp(root, 2);

    for (const trigger of root.querySelectorAll<HTMLElement>('[data-card-trigger]')) {
      expect(trigger.querySelector('[data-paper-turn-anchor-label]')).toBeNull();
      expect(trigger.parentElement?.querySelector('[data-paper-turn-anchor-label]')).not.toBeNull();
    }
  });

  it('renders deterministic detail content for a selected source id', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.renderDetail('spectrum');

    expect(app.detailHeading.textContent).toBe('Spectrum foundations');
    expect(app.detailSurface.textContent).toContain('Color, typography, and layout');
  });

  it('returns null for unknown source ids', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    expect(app.resolveSource('missing')).toBeNull();
  });

  it('returns null for selector-significant source ids without throwing', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    expect(() => app.resolveSource('bad"selector')).not.toThrow();
    expect(app.resolveSource('bad"selector')).toBeNull();
  });

  it('defines a visible focus outline for the detail heading', () => {
    const styles = readFileSync(stylesPath, 'utf8');

    expect(styles).not.toContain('.detail-content h2:focus { outline: none; }');
    expect(styles).toMatch(/\.detail-content h2:focus\s*\{[^}]*outline:\s*(?!none\b)[^;]+;[^}]*outline-offset:\s*[^;]+;/s);
  });
});
