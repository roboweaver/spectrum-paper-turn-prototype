import { describe, expect, it } from 'vitest';
import { createDemoApp } from '../../src/app';

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
});
