import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDetailPage } from '../../scripts/generate-detail-pages';
import { createDemoApp, type PendingDetail } from '../../src/app';
import { cardById, cards } from '../../src/data/cards';

const stylesPath = resolve(process.cwd(), 'src/styles.css');

/** Builds a fragment from markup, the way the extractor hands one over. */
function fragmentFrom(markup: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

/**
 * Content staged for one activation, taken from the page the generator emits for
 * that record — so these tests exercise the same markup the app will fetch.
 */
function stagedDetail(sourceId: string, color: string): PendingDetail {
  const page = renderDetailPage(cardById(sourceId));
  const parsed = new DOMParser().parseFromString(page, 'text/html');
  const template = parsed.querySelector<HTMLTemplateElement>('template[data-paper-turn-detail]');

  if (!template) {
    throw new Error(`generated page for "${sourceId}" has no adoptable region`);
  }

  return { sourceId, fragment: template.content, color };
}

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

  it('adopts the staged fragment as the detail content', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.setPendingDetail(stagedDetail('spectrum', '#5c5ce0'));
    app.renderDetail('spectrum');

    expect(app.detailHeading()?.textContent).toBe('Spectrum foundations');
    expect(app.detailSurface.textContent).toContain('Color, typography, and layout');
    expect(app.detailSurface.style.getPropertyValue('--detail-color')).toBe('#5c5ce0');
  });

  it('preserves the fragment structure rather than reshaping it', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);
    const fragment = fragmentFrom(`
      <h2 data-detail-heading tabindex="-1">Nested</h2>
      <section><div><h4>Fourth level</h4><p>Body</p></div></section>
      <figure><img src="x.png" alt="" /><figcaption>Caption</figcaption></figure>
    `);

    app.setPendingDetail({ sourceId: 'spectrum', fragment, color: '#000000' });
    app.renderDetail('spectrum');

    const content = root.querySelector('[data-detail-content]');
    expect(content?.querySelector('section div h4')?.textContent).toBe('Fourth level');
    expect(content?.querySelector('figure figcaption')?.textContent).toBe('Caption');
  });

  it('places the fragment as direct children of the flex column', () => {
    // Load-bearing for the settled baseline. `.detail-content` is a column flex
    // container and `.detail-footer` pins to the bottom with `margin: auto 0 0`,
    // which only works while the footer is a direct child. An extra wrapper would
    // silently break the pin.
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.setPendingDetail(stagedDetail('spectrum', '#5c5ce0'));
    app.renderDetail('spectrum');

    const content = root.querySelector<HTMLElement>('[data-detail-content]');
    expect(content?.classList.contains('detail-content')).toBe(true);
    expect(content?.querySelector(':scope > .detail-footer')).not.toBeNull();
    expect(content?.querySelector(':scope > h2[data-detail-heading]')).not.toBeNull();
  });

  it('replaces a previous adoption entirely', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.setPendingDetail(stagedDetail('spectrum', '#5c5ce0'));
    app.renderDetail('spectrum');
    app.setPendingDetail(stagedDetail('workflow', '#d83790'));
    app.renderDetail('workflow');

    const content = root.querySelector<HTMLElement>('[data-detail-content]');
    expect(app.detailHeading()?.textContent).toBe('Workflow patterns');
    expect(content?.textContent).not.toContain('Spectrum foundations');
    expect(content?.querySelectorAll('[data-detail-heading]')).toHaveLength(1);
    expect(app.detailSurface.style.getPropertyValue('--detail-color')).toBe('#d83790');
  });

  it('keeps the close affordance in the shell, outside the adopted region', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.setPendingDetail(stagedDetail('spectrum', '#5c5ce0'));
    app.renderDetail('spectrum');

    const content = root.querySelector<HTMLElement>('[data-detail-content]');
    expect(content?.contains(app.closeButton)).toBe(false);
    expect(app.detailSurface.contains(app.closeButton)).toBe(true);
  });

  it('keeps the adopted region inside sp-theme, so token inlining still works', () => {
    // `themeTokenCss` walks up with `closest('sp-theme')`. Outside it, the capture
    // clone inherits nothing and reproduces the collapsed-padding, wrong-greys bug
    // documented in docs/architecture.md.
    const root = document.createElement('div');
    createDemoApp(root);

    const content = root.querySelector<HTMLElement>('[data-detail-content]');
    expect(content?.closest('sp-theme')).not.toBeNull();
  });

  it('refuses to open with nothing staged, rather than opening blank', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    expect(() => app.renderDetail('spectrum')).toThrow(/No content staged/);
  });

  it('refuses to adopt content staged for a different activation', () => {
    // A mismatch would print the wrong page onto the sheet. Throwing routes through
    // the coordinator's existing open-setup recovery, so the page still opens.
    const root = document.createElement('div');
    const app = createDemoApp(root);

    app.setPendingDetail(stagedDetail('workflow', '#d83790'));

    expect(() => app.renderDetail('spectrum')).toThrow(/staged content is for "workflow"/i);
  });

  it('starts with no heading, because nothing has been adopted yet', () => {
    const root = document.createElement('div');
    const app = createDemoApp(root);

    expect(app.detailHeading()).toBeNull();
  });

  it('builds each tile trigger as a real anchor addressing its record url', () => {
    const root = document.createElement('div');
    createDemoApp(root, 16);

    const triggers = Array.from(root.querySelectorAll<HTMLElement>('[data-card-trigger]'));
    expect(triggers).toHaveLength(16);

    triggers.forEach((trigger, index) => {
      const card = cards[index];
      expect(card).toBeDefined();
      if (!card) return;

      expect(trigger.tagName, card.id).toBe('A');
      expect(trigger.getAttribute('href'), card.id).toBe(card.url);
      expect(trigger.dataset.sourceId, card.id).toBe(card.id);

      // No `type` attribute survives from the button it used to be.
      expect(trigger.hasAttribute('type'), card.id).toBe(false);
    });
  });

  it('keeps the anchor label a sibling of the trigger, not a descendant', () => {
    // Two reasons, both still live: `captureElement` captures the trigger subtree,
    // so a child would be printed onto the turning sheet, and the grab-anchor
    // resolver measures the trigger, so a child would distort the rect.
    const root = document.createElement('div');
    createDemoApp(root, 16);

    for (const trigger of root.querySelectorAll<HTMLElement>('[data-card-trigger]')) {
      expect(trigger.querySelector('[data-paper-turn-anchor-label]')).toBeNull();
      expect(
        trigger.parentElement?.querySelector('[data-paper-turn-anchor-label]'),
      ).not.toBeNull();
    }
  });

  it('keeps the tile heading and subheading slotted in light DOM', () => {
    // Attribute-only text is flattened away by html-to-image's `assignedNodes()`
    // walk, so the component visibly loses its label on the turning sheet while the
    // live DOM looks correct.
    const root = document.createElement('div');
    createDemoApp(root, 1);
    const card = cards[0];
    expect(card).toBeDefined();
    if (!card) return;

    const trigger = root.querySelector<HTMLElement>('[data-card-trigger]');
    expect(trigger?.querySelector('[slot="heading"]')?.textContent).toBe(card.title);
    expect(trigger?.querySelector('[slot="subheading"]')?.textContent).toBe(card.subtitle);
  });

  it('removes the UA link underline, which would inherit into the tile text', () => {
    // `color: inherit` handles the UA link colour; the underline needs its own
    // declaration and inherits into sp-card's slotted text, so omitting it would
    // underline every tile and move all six visual baselines.
    const styles = readFileSync(stylesPath, 'utf8');
    const rule = styles.slice(styles.indexOf('.card-trigger {'));

    expect(rule.slice(0, rule.indexOf('}'))).toContain('text-decoration: none');
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
