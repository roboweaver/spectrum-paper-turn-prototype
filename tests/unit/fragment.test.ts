import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderDetailPage } from '../../scripts/generate-detail-pages';
import {
  DEFAULT_DETAIL_COLOR,
  extractFragment,
  type FragmentSuccess,
} from '../../src/content/fragment';
import { cards } from '../../src/data/cards';

const FIXTURE_DIR = resolve(process.cwd(), 'public/fixtures');

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
}

/** Narrows to a success, failing with the reason when extraction did not succeed. */
function expectOk(html: string, label = 'fragment'): FragmentSuccess {
  const result = extractFragment(html);
  if (!result.ok) {
    throw new Error(`${label}: expected extraction to succeed, got ${result.reason}: ${result.message}`);
  }
  return result;
}

describe('extractFragment', () => {
  describe('well-formed pages', () => {
    it('extracts every generated detail page', () => {
      for (const card of cards) {
        const result = expectOk(renderDetailPage(card), card.id);

        expect(result.color, card.id).toBe(card.color);
        expect(result.title, card.id).toBe(card.title);
        expect(
          result.fragment.querySelector('[data-detail-heading]')?.textContent,
          card.id,
        ).toBe(card.title);
      }
    });

    it('preserves the region structure rather than reshaping it', () => {
      const result = expectOk(fixture('rich-content.html'));
      const fragment = result.fragment;

      // Depth beyond the old five-field skeleton survives.
      expect(fragment.querySelector('h4')).not.toBeNull();
      expect(fragment.querySelector('h5')).not.toBeNull();
      expect(fragment.querySelector('.wrapper .wrapper-inner h4')).not.toBeNull();

      // Element types the skeleton had no slot for survive.
      expect(fragment.querySelector('figure figcaption')).not.toBeNull();
      expect(fragment.querySelector('blockquote')).not.toBeNull();
      expect(fragment.querySelector('table caption')).not.toBeNull();
      expect(fragment.querySelectorAll('table tbody tr')).toHaveLength(2);
      expect(fragment.querySelectorAll('ul li')).toHaveLength(2);
      expect(fragment.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/');

      // Fragment-scoped styling travels with it.
      expect(fragment.querySelector('style')?.textContent).toContain('.wrapper-inner');
    });

    it('accepts the minimal conforming page and defaults its colour', () => {
      const result = expectOk(fixture('minimal.html'));

      expect(result.color).toBe(DEFAULT_DETAIL_COLOR);
      expect(result.title).toBe('Minimal conforming page');
      expect(result.fragment.querySelector('[data-detail-heading]')?.textContent).toBe('Minimal');
    });

    it('reads the colour hint and the document title when present', () => {
      const result = expectOk(fixture('rich-content.html'));

      expect(result.color).toBe('#bd6100');
      expect(result.title).toBe('A page with real content in it');
    });
  });

  describe('more than one marked region', () => {
    it('adopts the first in document order and warns, rather than failing', () => {
      const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = expectOk(fixture('two-regions.html'));

      // Document order, which in this fixture is the sidebar widget's copy — not
      // the article the page is actually for. That is precisely the mistake the
      // warning exists to surface: the sheet shows "Workflow patterns" while the
      // page's own title is "Spectrum foundations".
      expect(result.fragment.querySelector('[data-detail-heading]')?.textContent).toBe(
        'Workflow patterns',
      );
      expect(result.color).toBe('#d83790');
      expect(result.title).toBe('Spectrum foundations');

      expect(report).toHaveBeenCalledTimes(1);
      const message = String(report.mock.calls[0]?.[0] ?? '');
      expect(message).toContain('Paper-turn');
      expect(message).toContain('2');
      expect(message).toContain('data-paper-turn-detail');
      expect(message).toContain('first in document order');
    });

    it('stays silent for a conforming page with exactly one region', () => {
      const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expectOk(fixture('minimal.html'));
      expectOk(fixture('rich-content.html'));
      for (const card of cards) {
        expectOk(renderDetailPage(card), card.id);
      }

      expect(report).not.toHaveBeenCalled();
    });

    it('does not warn when the single region is unusable', () => {
      // The warning is about ambiguity, not about validity. A page with one bad
      // region gets a failure and no warning, so the two signals stay distinct.
      const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(extractFragment(fixture('no-heading.html')).ok).toBe(false);
      expect(extractFragment(fixture('region-not-template.html')).ok).toBe(false);
      expect(extractFragment(fixture('no-region.html')).ok).toBe(false);

      expect(report).not.toHaveBeenCalled();
    });
  });

  describe('contract violations, one per obligation', () => {
    it('reports missing-region when nothing is marked', () => {
      const result = extractFragment(fixture('no-region.html'));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('missing-region');
      expect(result.message).toContain('data-paper-turn-detail');
    });

    it('reports region-not-template when the region is a div', () => {
      const result = extractFragment(fixture('region-not-template.html'));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('region-not-template');
      expect(result.message).toContain('div');
      expect(result.message).toContain('template');
    });

    it('reports missing-heading when the region has no focus target', () => {
      const result = extractFragment(fixture('no-heading.html'));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('missing-heading');
      expect(result.message).toContain('data-detail-heading');
    });

    it('reports ambiguous-heading when the region has two', () => {
      const result = extractFragment(fixture('two-headings.html'));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('ambiguous-heading');
      expect(result.message).toContain('2');
    });

    it('lands a non-HTML body on missing-region, because HTML parsing never fails', () => {
      const result = extractFragment(fixture('not-html.json'));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('missing-region');
    });

    it('never throws, whatever it is handed', () => {
      for (const input of ['', '   ', '<!doctype html>', 'plain text', '<p>unclosed', '\u0000']) {
        expect(() => extractFragment(input), JSON.stringify(input)).not.toThrow();
        expect(extractFragment(input).ok, JSON.stringify(input)).toBe(false);
      }
    });
  });

  describe('inertness before adoption', () => {
    it('does not load images or run scripts while the fragment is unadopted', () => {
      const flags = globalThis as Record<string, unknown>;
      delete flags.__paperTurnFixtureScriptFired;
      delete flags.__paperTurnFixtureHandlerFired;

      const result = expectOk(fixture('inline-handler.html'));

      // importNode does not run script elements, and the parsed document is inert,
      // so neither the script nor the broken image's handler has fired yet.
      expect(flags.__paperTurnFixtureScriptFired).toBeUndefined();
      expect(flags.__paperTurnFixtureHandlerFired).toBeUndefined();

      // The image has not begun loading: no resolved currentSrc.
      const image = result.fragment.querySelector('img');
      expect(image).not.toBeNull();
      expect(image?.currentSrc ?? '').toBe('');
    });

    it('adopts an inline handler unchanged rather than sanitising it', () => {
      // A recorded decision, not an oversight. The design adopts faithfully so the
      // reverse face is the real page; what licenses that is the trust assumption,
      // not stripping. If a sanitiser is ever added, this test is where the
      // decision resurfaces instead of being made silently.
      const result = expectOk(fixture('inline-handler.html'));

      expect(result.fragment.querySelector('img')?.getAttribute('onerror')).toContain(
        '__paperTurnFixtureHandlerFired',
      );
      expect(result.fragment.querySelector('button')?.getAttribute('onclick')).toContain(
        '__paperTurnFixtureClickFired',
      );

      // The <script> element is preserved as markup too; it simply will not run
      // when adopted via importNode. Inertness is a property of how it is inserted,
      // not of it having been removed.
      expect(result.fragment.querySelector('script')).not.toBeNull();
    });
  });

  describe('purity', () => {
    it('mutates neither the input nor the live document', () => {
      const html = fixture('rich-content.html');
      const before = html;
      const documentBefore = document.body.innerHTML;

      extractFragment(html);

      expect(html).toBe(before);
      expect(document.body.innerHTML).toBe(documentBefore);
    });

    it('returns an equal result for equal input, and a fresh fragment each time', () => {
      const first_card = cards[0];
      if (!first_card) throw new Error('expected at least one card record');
      const html = renderDetailPage(first_card);
      const first = expectOk(html);
      const second = expectOk(html);

      expect(second.color).toBe(first.color);
      expect(second.title).toBe(first.title);
      expect(second.fragment.querySelector('[data-detail-heading]')?.textContent).toBe(
        first.fragment.querySelector('[data-detail-heading]')?.textContent,
      );

      // Independent fragments, so a caller adopting one cannot empty the other.
      // `importNode`'s deep copy leaves the source intact; a bare `appendChild`
      // would move the nodes out.
      expect(second.fragment).not.toBe(first.fragment);

      const host = document.createElement('div');
      host.append(document.importNode(first.fragment, true));
      expect(first.fragment.childNodes.length).toBeGreaterThan(0);
      expect(host.querySelector('[data-detail-heading]')).not.toBeNull();
    });
  });
});
