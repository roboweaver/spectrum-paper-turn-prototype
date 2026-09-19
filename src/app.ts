import { cardById, cards, type CardRecord } from './data/cards';
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

export interface DemoApp {
  listSurface: HTMLElement;
  detailSurface: HTMLElement;
  detailHeading: HTMLElement;
  listFocusFallback: HTMLElement;
  closeButton: HTMLElement;
  /** The tile grid itself, so activation can be delegated from one listener. */
  cardGrid: HTMLElement;
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

  const button = document.createElement('button');
  button.className = 'card-trigger';
  button.setAttribute('data-card-trigger', '');
  button.dataset.sourceId = card.id;
  button.type = 'button';

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
            <p class="eyebrow">Spectrum Web Components prototype</p>
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
        <article class="detail-surface" data-detail-surface hidden>
          <div class="detail-toolbar">
            <sp-button data-close-button variant="secondary">Back to cards</sp-button>
          </div>
          <div class="detail-content">
            <p class="eyebrow" data-detail-subtitle></p>
            <h2 data-detail-heading tabindex="-1"></h2>
            <p data-detail-description></p>
            <div class="detail-body" data-detail-body></div>
            <p class="detail-footer" data-detail-footer></p>
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
  const detailBody = root.querySelector<HTMLElement>('[data-detail-body]');
  const detailFooter = root.querySelector<HTMLElement>('[data-detail-footer]');

  if (
    !listSurface ||
    !detailSurface ||
    !detailHeading ||
    !listFocusFallback ||
    !closeButton ||
    !detailSubtitle ||
    !detailDescription ||
    !detailBody ||
    !detailFooter
  ) {
    throw new Error('Demo DOM contract is incomplete');
  }

  const document = root.ownerDocument;
  const cardGrid = listFocusFallback;
  let renderedCount = 0;

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
    detailHeading,
    listFocusFallback,
    closeButton,
    cardGrid,
    renderDetail(sourceId: string) {
      const card = cardById(sourceId);
      detailHeading.textContent = card.title;
      detailSubtitle.textContent = card.subtitle;
      detailDescription.textContent = card.description;
      detailFooter.textContent = card.footer;
      detailBody.replaceChildren(
        ...card.sections.map((section) => {
          const wrapper = document.createElement('section');
          const heading = document.createElement('h3');
          heading.textContent = section.heading;
          const body = document.createElement('p');
          body.textContent = section.body;
          wrapper.append(heading, body);
          return wrapper;
        }),
      );
      detailSurface.style.setProperty('--detail-color', card.color);
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
