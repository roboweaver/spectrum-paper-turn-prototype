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
