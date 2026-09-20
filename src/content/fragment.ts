/**
 * Fragment extraction: the pure half of content resolution.
 *
 * Maps a detail page's HTML to the DOM subtree that becomes the turning sheet's
 * reverse face, or to a named reason it could not. No network access, no live
 * document mutation, and no throwing — a contract violation is an ordinary
 * outcome that the activation path turns into a fall-through navigation, because
 * the tile is a real link and the page still works without the enhancement.
 */

/** Marks the adoptable region. Must be on a `<template>`. */
export const DETAIL_REGION_SELECTOR = '[data-paper-turn-detail]';

/** The focus target the settle step moves focus to. Exactly one, in the region. */
export const DETAIL_HEADING_SELECTOR = '[data-detail-heading]';

/** Optional colour hint, feeding `--detail-color`. */
export const DETAIL_COLOR_ATTRIBUTE = 'data-paper-turn-color';

/**
 * Applied when a page supplies no `data-paper-turn-color`.
 *
 * Spectrum's blue, matching the focus outline in `styles.css`, so an unstyled
 * page still lands somewhere deliberate rather than on an empty custom property.
 */
export const DEFAULT_DETAIL_COLOR = '#1473e6';

export type FragmentFailureReason =
  /** No `[data-paper-turn-detail]` in the document. Also where a non-HTML body lands. */
  | 'missing-region'
  /** The region is marked but is not a `<template>`. */
  | 'region-not-template'
  /** The region holds no `[data-detail-heading]`. */
  | 'missing-heading'
  /** The region holds more than one `[data-detail-heading]`. */
  | 'ambiguous-heading';

export interface FragmentSuccess {
  readonly ok: true;
  /**
   * The region's content, owned by the inert parsed document.
   *
   * Still inert: adopting it with `document.importNode(fragment, true)` is what
   * makes it live, and what starts its subresources loading. That ordering is
   * load-bearing for the capture sequencing — images must be awaited *after*
   * adoption and *before* rasterisation.
   */
  readonly fragment: DocumentFragment;
  /** The page's colour hint, or `DEFAULT_DETAIL_COLOR`. */
  readonly color: string;
  /** The page's `<title>`, or `null`. Unused in Phase 1; Phase 3 pushes it. */
  readonly title: string | null;
}

export interface FragmentFailure {
  readonly ok: false;
  readonly reason: FragmentFailureReason;
  /** Names the unmet obligation, for a console a page author can act on. */
  readonly message: string;
}

export type FragmentResult = FragmentSuccess | FragmentFailure;

function fail(reason: FragmentFailureReason, message: string): FragmentFailure {
  return { ok: false, reason, message };
}

/**
 * Extracts the adoptable fragment from a detail page's HTML.
 *
 * Parsing goes through `DOMParser` rather than an `innerHTML` assignment, and the
 * difference matters twice over. The parsed document is inert, so nothing loads
 * or executes until the fragment is adopted — which is what puts the capture
 * sequencing under our control. And the result is a real document to query
 * rather than a string to pattern-match.
 *
 * On the unreachable branch: `parseFromString(html, 'text/html')` does not throw
 * and produces no `parsererror` node — that is XML-mode behaviour. HTML parsing
 * is defined to recover from anything, so there is no "malformed HTML" outcome to
 * detect. A non-HTML body simply yields a document with no marked region and
 * fails as `missing-region`, which `public/fixtures/not-html.json` pins down.
 */
export function extractFragment(html: string): FragmentResult {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // `querySelector` takes the first match. A page marking two regions gets its
  // first one rather than an error, which is the literal reading of the contract
  // and a candidate for the Phase 6 authoring lint rather than a runtime failure.
  const region = parsed.querySelector(DETAIL_REGION_SELECTOR);

  if (!region) {
    return fail(
      'missing-region',
      `No ${DETAIL_REGION_SELECTOR} region found, so there is nothing to adopt.`,
    );
  }

  if (!(region instanceof HTMLTemplateElement)) {
    return fail(
      'region-not-template',
      `The ${DETAIL_REGION_SELECTOR} region is <${region.tagName.toLowerCase()}>, but must be a <template> so the page can render it standalone without displaying it twice.`,
    );
  }

  // Scoped to the template's content, not to the document: template content
  // lives in a separate DocumentFragment that document-level queries cannot see.
  const headings = region.content.querySelectorAll(DETAIL_HEADING_SELECTOR);

  if (headings.length === 0) {
    return fail(
      'missing-heading',
      `The ${DETAIL_REGION_SELECTOR} region holds no ${DETAIL_HEADING_SELECTOR}, so the turn would settle with focus detached from the surface.`,
    );
  }

  if (headings.length > 1) {
    return fail(
      'ambiguous-heading',
      `The ${DETAIL_REGION_SELECTOR} region holds ${headings.length} ${DETAIL_HEADING_SELECTOR} elements, so which one receives focus would be an arbitrary choice.`,
    );
  }

  const declaredColor = region.getAttribute(DETAIL_COLOR_ATTRIBUTE)?.trim();
  const title = parsed.title.trim();

  return {
    ok: true,
    fragment: region.content,
    color: declaredColor && declaredColor.length > 0 ? declaredColor : DEFAULT_DETAIL_COLOR,
    title: title.length > 0 ? title : null,
  };
}
