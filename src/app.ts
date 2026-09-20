import { cards, type CardRecord } from './data/cards';
import { resolveGrabAnchor } from './transition/grab-anchor';
import type { Rect } from './transition/types';
import {
  clampTileCount,
  DEFAULT_TILE_COUNT,
  type GridShape,
  gridShapeFor,
} from './tile-grid';

/** Measured tiles, in document order, sharing one index space. */
export interface TileMeasurements {
  triggers: HTMLElement[];
  rects: Rect[];
}

/**
 * Content resolved for one activation, handed to the view before
 * `coordinator.open()` is called.
 *
 * This is how the fragment reaches the view without the coordinator learning
 * about the network. `prepareDetail` stays synchronous and
 * `TransitionView.prepareDetail(sourceId: string): void` keeps its signature; the
 * content arrives out of band, already resolved.
 */
export interface PendingDetail {
  /** The activation this content belongs to, so a mismatch is detectable. */
  sourceId: string;
  /** Inert until adopted. */
  fragment: DocumentFragment;
  /** Feeds `--detail-color`, from the page rather than from a local record. */
  color: string;
}

export interface DemoApp {
  listSurface: HTMLElement;
  detailSurface: HTMLElement;
  /**
   * The adopted fragment's focus target, resolved lazily.
   *
   * Was a fixed element when the shell owned a five-field skeleton. It is now a
   * different element after every adoption, so it cannot be captured once at
   * construction.
   */
  detailHeading(): HTMLElement | null;
  listFocusFallback: HTMLElement;
  closeButton: HTMLElement;
  /** The tile grid itself, so activation can be delegated from one listener. */
  cardGrid: HTMLElement;
  /** Stage the content for the next activation. Call before `coordinator.open()`. */
  setPendingDetail(pending: PendingDetail | null): void;
  renderDetail(sourceId: string): void;
  resolveSource(sourceId: string): HTMLElement | null;
  measureTiles(): TileMeasurements;
  tileCount(): number;
  /** Render `count` tiles and lay them out, returning the shape they took. */
  setTileCount(count: number): GridShape;
  /** Re-lay-out the tiles already rendered, for a viewport change. */
  refreshLayout(): GridShape;
  anchorLabelsVisible(): boolean;
  setAnchorLabelsVisible(visible: boolean): void;
}

function createCardItem(document: Document, card: CardRecord): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'card-grid-item';

  // An anchor rather than a button, which is a correctness change independent of
  // the transition: the index works before this script has loaded or if it fails,
  // crawlers and assistive technology see a real navigable link, and cmd-click,
  // middle-click, and "open in new tab" work natively. The delegated handler in
  // main.ts is responsible for not swallowing those — see its modified-click guard.
  const button = document.createElement('a');
  button.className = 'card-trigger';
  button.setAttribute('data-card-trigger', '');
  button.dataset.sourceId = card.id;
  button.href = card.url;

  const cardElement = document.createElement('sp-card');
  cardElement.setAttribute('heading', card.title);
  cardElement.setAttribute('subheading', card.subtitle);
  cardElement.setAttribute('size', 's');

  // Slotted headings (rather than attribute-only) keep the text in light DOM so
  // the transition's html-to-image capture reproduces it; slot fallback content
  // is dropped during serialisation.
  const heading = document.createElement('h3');
  heading.slot = 'heading';
  heading.textContent = card.title;

  const subheading = document.createElement('div');
  subheading.slot = 'subheading';
  subheading.textContent = card.subtitle;

  const preview = document.createElement('div');
  preview.slot = 'preview';
  preview.className = 'card-preview';
  preview.style.setProperty('--card-color', card.color);

  const description = document.createElement('p');
  description.textContent = card.description;

  cardElement.append(preview, heading, subheading, description);
  button.append(cardElement);

  // The anchor label is a sibling of the trigger, not a child, for two reasons:
  // `captureElement` captures the trigger subtree, so a child would be printed
  // onto the turning sheet, and it must not be part of what the grab-anchor
  // resolver measures. It is absolutely positioned, so it claims no grid space.
  const anchorLabel = document.createElement('span');
  anchorLabel.className = 'tile-anchor-label';
  anchorLabel.setAttribute('data-paper-turn-anchor-label', 'true');
  anchorLabel.setAttribute('aria-hidden', 'true');

  item.append(button, anchorLabel);

  return item;
}

export function createDemoApp(
  root: HTMLElement,
  initialTileCount: number = DEFAULT_TILE_COUNT,
): DemoApp {
  root.innerHTML = `
    <sp-theme system="spectrum" color="light" scale="medium">
      <main class="demo-shell">
        <section class="list-surface" data-list-surface aria-busy="false">
          <header class="hero">
            <!-- The links share the eyebrow's line rather than taking one of
                 their own, which is what keeps them off the page's height. The
                 hero sits above the grid in every visual baseline, and the
                 midline baseline runs at 400 x 1200 with only ~60px of slack
                 before a fullPage capture would start scrolling the page and fire
                 the resize the coordinator treats as an interruption. See
                 tests/e2e/visual.spec.ts. -->
            <div class="hero-meta">
              <p class="eyebrow">Spectrum Web Components prototype</p>
              <nav class="hero-links" aria-label="Project links">
                <a href="https://github.com/roboweaver/spectrum-paper-turn-prototype">Source on GitHub</a>
                <a href="https://accuweaver.com">AccuWeaver</a>
              </nav>
            </div>
            <h1>Paper-turn navigation</h1>
            <!-- Deliberately unchanged copy. The hero sits above the grid in
                 every visual baseline, so a sentence added here reflows the whole
                 page and invalidates six screenshots on two platforms. What the
                 tile control does is explained in its tooltip, the anchor labels,
                 and the README instead. -->
            <p>Choose a card to open a full-page detail surface.</p>
          </header>
          <ul class="card-grid" data-list-focus-fallback data-anchor-labels="true" tabindex="-1" aria-label="Design topics"></ul>
        </section>
        <!-- tabindex="-1" so focusDetailHeading has somewhere inside the surface to
             land if an adopted fragment somehow arrives without its heading.
             Programmatic focus on a non-input does not trigger :focus-visible and
             the surface carries no :focus style, so this paints nothing. -->
        <article class="detail-surface" data-detail-surface tabindex="-1" hidden>
          <div class="detail-toolbar">
            <sp-button data-close-button variant="secondary">Back to cards</sp-button>
          </div>
          <!-- The adoption target, and deliberately empty. Arbitrary pages cannot
               be squeezed through five named string slots, so the shell owns the
               toolbar and the fetched fragment owns the whole content region.
               detail-content is itself the region rather than holding one, and that
               is load-bearing. It is a column flex container, and detail-footer
               pins itself to the bottom with margin: auto 0 0. Wrapping the
               fragment in an extra element would make the footer a grandchild,
               break that pin, and move the settled baseline -- so the fragment's
               top-level nodes must be direct children here.
               It also has to stay inside sp-theme, or themeTokenCss stops finding a
               theme ancestor by closest() and the capture loses its tokens. -->
          <div class="detail-content" data-detail-content></div>
        </article>
      </main>
    </sp-theme>
  `;

  const listSurface = root.querySelector<HTMLElement>('[data-list-surface]');
  const detailSurface = root.querySelector<HTMLElement>('[data-detail-surface]');
  const detailContent = root.querySelector<HTMLElement>('[data-detail-content]');
  const listFocusFallback = root.querySelector<HTMLElement>('[data-list-focus-fallback]');
  const closeButton = root.querySelector<HTMLElement>('[data-close-button]');

  if (!listSurface || !detailSurface || !detailContent || !listFocusFallback || !closeButton) {
    throw new Error('Demo DOM contract is incomplete');
  }

  const document = root.ownerDocument;
  const cardGrid = listFocusFallback;
  let renderedCount = 0;
  let pendingDetail: PendingDetail | null = null;
  let adoptedSourceId: string | null = null;

  /**
   * Measure every tile in the grid, in document order, so the activated tile's
   * grid position can be recovered from the layout the user can actually see.
   *
   * Each `[data-card-trigger]` element's bounding rect is read exactly once,
   * which makes this a single layout pass costing `O(tiles)`. It runs on
   * activation, not per frame, and the returned `triggers` list shares the index
   * space of `rects`, so `triggers.indexOf(trigger)` locates the activated tile.
   */
  const measureTiles = (): TileMeasurements => {
    const triggers = Array.from(cardGrid.querySelectorAll<HTMLElement>('[data-card-trigger]'));
    const rects = triggers.map((trigger) => {
      const { left, top, width, height } = trigger.getBoundingClientRect();
      return { left, top, width, height };
    });

    return { triggers, rects };
  };

  /**
   * Label each tile with the anchor it would be grabbed by, read from the same
   * resolver the activation path uses so the labels cannot claim one thing while
   * the turn does another.
   *
   * Runs after the column count has been written, so the rects it reads are the
   * ones the new layout produced.
   */
  const refreshAnchorLabels = (): void => {
    const { triggers, rects } = measureTiles();

    triggers.forEach((trigger, index) => {
      const label = trigger.parentElement?.querySelector<HTMLElement>('[data-paper-turn-anchor-label]');

      if (label) {
        label.textContent = resolveGrabAnchor(rects, index);
      }
    });
  };

  const applyLayout = (): GridShape => {
    const shape = gridShapeFor(renderedCount, cardGrid.clientWidth);
    cardGrid.style.setProperty('--grid-columns', String(shape.columnCount));
    refreshAnchorLabels();

    return shape;
  };

  const renderTiles = (count: number): void => {
    renderedCount = Math.min(clampTileCount(count), cards.length);
    cardGrid.replaceChildren(
      ...cards.slice(0, renderedCount).map((card) => createCardItem(document, card)),
    );
  };

  renderTiles(initialTileCount);
  applyLayout();

  detailSurface.inert = true;

  return {
    listSurface,
    detailSurface,
    detailHeading() {
      return detailContent.querySelector<HTMLElement>('[data-detail-heading]');
    },
    listFocusFallback,
    closeButton,
    cardGrid,
    setPendingDetail(pending: PendingDetail | null) {
      pendingDetail = pending;
      // Staging new content invalidates any previous adoption, so the next
      // `renderDetail` adopts rather than short-circuiting.
      adoptedSourceId = null;
    },
    /**
     * Adopt the staged content. **Idempotent** for a given activation.
     *
     * Called twice per activation, and the idempotence is what makes that safe.
     * The activation path calls it first so that images can begin loading and be
     * awaited before the capture; `coordinator.open()` then calls it again through
     * `prepareDetail`. Re-adopting on the second call would replace the nodes with
     * fresh ones and restart their subresource loading, discarding the wait that
     * had just been paid for.
     */
    renderDetail(sourceId: string) {
      if (!pendingDetail) {
        throw new Error(
          `No content staged for "${sourceId}". Resolve it and call setPendingDetail before opening.`,
        );
      }

      if (pendingDetail.sourceId !== sourceId) {
        // A mismatch means the wrong page's content is about to be printed onto
        // the sheet, which is exactly the silent-wrong-content failure the
        // fragment contract works to avoid. Throwing routes through the
        // coordinator's existing open-setup recovery and the fallback transition,
        // so the page still opens.
        throw new Error(
          `Staged content is for "${pendingDetail.sourceId}" but "${sourceId}" is opening.`,
        );
      }

      if (adoptedSourceId === sourceId) {
        return;
      }

      // Deep copy, so the resolver's fragment survives for a retry and the
      // adopted nodes are ours. `replaceChildren` clears the previous adoption
      // entirely, leaving none of it behind.
      detailContent.replaceChildren(document.importNode(pendingDetail.fragment, true));
      detailSurface.style.setProperty('--detail-color', pendingDetail.color);
      adoptedSourceId = sourceId;
    },
    resolveSource(sourceId: string) {
      return Array.from(root.querySelectorAll<HTMLElement>('[data-card-trigger]')).find((element) => element.dataset.sourceId === sourceId) ?? null;
    },
    measureTiles,
    tileCount() {
      return renderedCount;
    },
    setTileCount(count: number) {
      renderTiles(count);
      return applyLayout();
    },
    refreshLayout: applyLayout,
    anchorLabelsVisible() {
      return cardGrid.dataset.anchorLabels !== 'false';
    },
    setAnchorLabelsVisible(visible: boolean) {
      cardGrid.dataset.anchorLabels = String(visible);
    },
  };
}
