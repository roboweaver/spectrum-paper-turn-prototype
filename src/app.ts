import { cardById, cards } from './data/cards';

export interface DemoApp {
  listSurface: HTMLElement;
  detailSurface: HTMLElement;
  detailHeading: HTMLElement;
  listFocusFallback: HTMLElement;
  closeButton: HTMLElement;
  renderDetail(sourceId: string): void;
  resolveSource(sourceId: string): HTMLElement | null;
}

function cardMarkup(id: string, title: string, subtitle: string, description: string, color: string): string {
  return `
    <button class="card-trigger" data-card-trigger data-source-id="${id}" type="button">
      <sp-card heading="${title}" subheading="${subtitle}" size="s">
        <div slot="preview" class="card-preview" style="--card-color: ${color}"></div>
        <p>${description}</p>
      </sp-card>
    </button>
  `;
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
          <div class="card-grid" data-list-focus-fallback tabindex="-1" aria-label="Design topics">
            ${cards.map((card) => cardMarkup(card.id, card.title, card.subtitle, card.description, card.color)).join('')}
          </div>
        </section>
        <article class="detail-surface" data-detail-surface hidden>
          <div class="detail-toolbar">
            <sp-button data-close-button variant="secondary">Back to cards</sp-button>
          </div>
          <div class="detail-content">
            <p class="eyebrow" data-detail-subtitle></p>
            <h2 data-detail-heading tabindex="-1"></h2>
            <p data-detail-description></p>
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

  if (!listSurface || !detailSurface || !detailHeading || !listFocusFallback || !closeButton || !detailSubtitle || !detailDescription) {
    throw new Error('Demo DOM contract is incomplete');
  }

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
      detailSurface.style.setProperty('--detail-color', card.color);
    },
    resolveSource(sourceId: string) {
      return root.querySelector<HTMLElement>(`[data-card-trigger][data-source-id="${sourceId}"]`);
    },
  };
}
