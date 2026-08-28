import { cardById, cards, type CardRecord } from './data/cards';

export interface DemoApp {
  listSurface: HTMLElement;
  detailSurface: HTMLElement;
  detailHeading: HTMLElement;
  listFocusFallback: HTMLElement;
  closeButton: HTMLElement;
  renderDetail(sourceId: string): void;
  resolveSource(sourceId: string): HTMLElement | null;
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
  item.append(button);

  return item;
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
          <ul class="card-grid" data-list-focus-fallback tabindex="-1" aria-label="Design topics"></ul>
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
  cards.forEach((card) => {
    listFocusFallback.append(createCardItem(document, card));
  });

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
  };
}
