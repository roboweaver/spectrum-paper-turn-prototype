import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDetailPage } from '../../scripts/generate-detail-pages';
import { createDemoApp } from '../../src/app';
import { extractFragment } from '../../src/content/fragment';
import { type CardRecord, cards, detailPagePath } from '../../src/data/cards';

/**
 * Parses a generated page and returns the adoptable region's content as an
 * element, so its structure can be compared against the live shell's.
 */
function templateContentOf(html: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const template = parsed.querySelector<HTMLTemplateElement>(
    'template[data-paper-turn-detail]',
  );
  if (!template) {
    throw new Error('generated page has no [data-paper-turn-detail] template');
  }
  const host = document.createElement('div');
  host.append(document.importNode(template.content, true));
  return host;
}

/**
 * Structure without whitespace: tag name, class attribute, and text, depth
 * first. Comparing this rather than `innerHTML` keeps the assertion about what
 * CSS and the capture can see, and insensitive to how either side indents.
 */
function structureOf(root: ParentNode): string {
  return Array.from(root.children)
    .map((child) => {
      const className = child.className ? `.${child.className.split(/\s+/).join('.')}` : '';
      const own = child.children.length === 0 ? `:${child.textContent?.trim() ?? ''}` : '';
      const nested = child.children.length > 0 ? `(${structureOf(child)})` : '';
      return `${child.tagName.toLowerCase()}${className}${own}${nested}`;
    })
    .join(',');
}

/**
 * The structures `renderDetail` produced before the five-field skeleton was
 * removed, captured from the live shell while it still existed.
 *
 * These are the reference for Requirement 12. Five of the six committed visual
 * frames carry captured detail content — only `paper-turn-start` is grid-only — so
 * the generated pages must keep producing exactly this or ten reference images
 * across two platforms move.
 *
 * Do not regenerate this file to make a failing test pass. A diff here means the
 * rendered detail DOM has changed, which means the baselines have moved, which is
 * a decision to make deliberately and review by eye rather than a fixture to
 * refresh.
 */
const GOLDEN_STRUCTURES = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/unit/detail-content.golden.json'), 'utf8'),
) as Record<string, string>;

describe('generate-detail-pages', () => {
  it('emits one page per record, each satisfying the fragment contract', () => {
    expect(cards).toHaveLength(16);

    for (const card of cards) {
      const parsed = new DOMParser().parseFromString(renderDetailPage(card), 'text/html');
      const regions = parsed.querySelectorAll('[data-paper-turn-detail]');

      expect(regions, card.id).toHaveLength(1);

      const region = regions[0];
      expect(region, card.id).toBeInstanceOf(HTMLTemplateElement);
      if (!(region instanceof HTMLTemplateElement)) return;

      const content = region.content;
      expect(content.querySelectorAll('[data-detail-heading]'), card.id).toHaveLength(1);
      expect(
        content.querySelector('[data-detail-heading]')?.getAttribute('tabindex'),
        card.id,
      ).toBe('-1');
    }
  });

  it('names each page after the url its record advertises', () => {
    for (const card of cards) {
      expect(card.url).toBe(detailPagePath(card.id));
      expect(card.url).toMatch(/^detail\/[a-z0-9-]+\.html$/);
    }

    expect(new Set(cards.map((card) => card.url)).size).toBe(cards.length);
  });

  /**
   * The load-bearing test, and the only mechanical guarantee behind Requirement 12.
   *
   * It compared against `renderDetail`'s live output while the five-field skeleton
   * existed. Task 6.1 removed that skeleton, so the comparison is now against the
   * structures captured from it — same assertion, frozen reference.
   */
  it('reproduces the pre-migration renderDetail structure exactly, for every record', () => {
    expect(Object.keys(GOLDEN_STRUCTURES)).toHaveLength(cards.length);

    for (const card of cards) {
      const generated = structureOf(templateContentOf(renderDetailPage(card)));

      expect(GOLDEN_STRUCTURES[card.id], `no golden structure for ${card.id}`).toBeDefined();
      expect(generated, `record ${card.id}`).toBe(GOLDEN_STRUCTURES[card.id]);
    }
  });

  it('produces, once adopted, the same structure the golden records', () => {
    // The golden captures what the *shell* rendered. This asserts the round trip —
    // generate a page, extract its fragment, adopt it into the real shell — lands
    // in the same place. Without this, the generator could match the golden while
    // adoption reshaped it on the way in.
    for (const card of cards) {
      const root = document.createElement('div');
      const app = createDemoApp(root, 16);
      const extracted = extractFragment(renderDetailPage(card));

      expect(extracted.ok, card.id).toBe(true);
      if (!extracted.ok) continue;

      app.setPendingDetail({ sourceId: card.id, fragment: extracted.fragment, color: card.color });
      app.renderDetail(card.id);

      const content = root.querySelector<HTMLElement>('[data-detail-content]');
      expect(content, card.id).not.toBeNull();
      if (!content) continue;

      expect(structureOf(content), `record ${card.id} after adoption`).toBe(
        GOLDEN_STRUCTURES[card.id],
      );
    }
  });

  it('carries the record colour as the page-supplied colour hint', () => {
    for (const card of cards) {
      const parsed = new DOMParser().parseFromString(renderDetailPage(card), 'text/html');
      const region = parsed.querySelector('[data-paper-turn-detail]');

      expect(region?.getAttribute('data-paper-turn-color'), card.id).toBe(card.color);
    }
  });

  it('renders standalone, with a visible copy outside the template', () => {
    for (const card of cards) {
      const parsed = new DOMParser().parseFromString(renderDetailPage(card), 'text/html');

      // A <template>'s content is not rendered, so a page holding only the
      // template would be blank when opened directly.
      const visible = parsed.querySelector('main');
      expect(visible, card.id).not.toBeNull();
      expect(visible?.textContent, card.id).toContain(card.title);
      expect(parsed.title, card.id).toBe(card.title);

      // Zero focus targets at document level, and this is two facts at once.
      //
      // The visible copy deliberately omits the marker, so a direct visit has no
      // stray `tabindex="-1"` heading. And a <template>'s content lives in a
      // separate DocumentFragment that document-level `querySelectorAll` cannot
      // see — which is exactly why the extractor has to scope its "exactly one
      // heading" check to `template.content` rather than to the parsed document.
      expect(parsed.querySelectorAll('[data-detail-heading]'), card.id).toHaveLength(0);

      const template = parsed.querySelector<HTMLTemplateElement>(
        'template[data-paper-turn-detail]',
      );
      expect(template?.content.querySelectorAll('[data-detail-heading]'), card.id).toHaveLength(1);
    }
  });

  it('is deterministic', () => {
    for (const card of cards) {
      expect(renderDetailPage(card)).toBe(renderDetailPage(card));
    }
  });

  it('escapes text that would otherwise change the markup', () => {
    const hostile: CardRecord = {
      id: 'hostile',
      title: 'Title with <b>markup</b> & an "attribute"',
      subtitle: 'Sub & title',
      description: 'A < B && B > C',
      color: '"><script>',
      url: 'detail/hostile.html',
      sections: [{ heading: '<h3>', body: 'Body with </section> in it' }],
      footer: 'Footer & <end>',
    };

    const html = renderDetailPage(hostile);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const template = parsed.querySelector<HTMLTemplateElement>('template[data-paper-turn-detail]');
    const content = template?.content;

    // The text survives as text, and none of it became an element.
    expect(content?.querySelector('[data-detail-heading]')?.textContent).toBe(hostile.title);
    expect(content?.querySelector('[data-detail-heading]')?.querySelector('b')).toBeNull();
    expect(content?.querySelectorAll('section')).toHaveLength(1);
    expect(content?.querySelector('section h3')?.textContent).toBe('<h3>');
    expect(content?.querySelector('.detail-footer')?.textContent).toBe(hostile.footer);

    // The colour hint is an attribute value, so it must not be able to close it.
    expect(template?.getAttribute('data-paper-turn-color')).toBe(hostile.color);
    expect(content?.querySelector('script')).toBeNull();
  });
});
