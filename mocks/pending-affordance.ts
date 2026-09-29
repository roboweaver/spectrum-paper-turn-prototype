/**
 * Mock for Phase 2's one remaining open question: what the pending affordance on an
 * activated tile should look like.
 *
 * Built against the real `sp-card` and the real `styles.css` rather than an
 * approximation, because the decision turns on how a treatment reads on the actual
 * Spectrum component with the actual tokens — a hand-rolled div would answer a
 * different question.
 *
 * Dev-only. Not imported by `src/`, not part of the build entry, and every candidate
 * style lives in this file rather than in `styles.css` so nothing here can reach the
 * application or its visual baselines.
 *
 * **Outcome: option A, the dim, was chosen**, paired with `aria-busy` on the trigger.
 * The reasoning is frequency rather than aesthetics — once prefetch lands, most
 * activations are cache hits that never reach the delay threshold, so the affordance is
 * the exception path and should be the quietest thing that works. The other three are
 * kept here rather than deleted, so the comparison that produced the decision can be
 * re-run if it is ever revisited. See the design's "Chosen: dim the card" section.
 *
 * The three constraints from the design, which the options are meant to be judged
 * against:
 *
 * 1. **No layout movement.** Every visual baseline contains the grid, and
 *    `paper-turn-start` is grid-only. A treatment that changes a tile's size or
 *    position moves six frames on two platforms.
 * 2. **Nothing on the fast path.** A flash of pending state on a cache hit is worse
 *    than no affordance, because it draws the eye to something already finished.
 * 3. **Scoped to the tile, not the page.** Nothing is frozen while resolution is
 *    pending, so a page-level spinner would contradict the state the page is in.
 */

import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/card/sp-card.js';
import '../src/styles.css';
import { cards } from '../src/data/cards';

interface Option {
  id: string;
  name: string;
  verdict: string;
  note: string;
  css: string;
}

/**
 * Every option is driven by one attribute, `data-paper-turn-pending`, so the
 * production change would be a single attribute toggle plus a block of CSS. None of
 * them alters box size, position, or margin.
 */
const OPTIONS: Option[] = [
  {
    id: 'dim',
    name: 'A — Dim',
    verdict: 'Most conservative. Nothing new is drawn.',
    note: 'One property. Reads as "not yet" rather than "working", which is honest for a wait that is usually over in a frame or two. Risks looking disabled rather than busy.',
    css: `
      [data-option='dim'] [data-paper-turn-pending='true'] sp-card {
        opacity: 0.55;
        transition: opacity 120ms ease-out;
      }
    `,
  },
  {
    id: 'pulse',
    name: 'B — Pulse',
    verdict: 'Says "working" rather than "not yet".',
    note: 'Motion carries the meaning, which is the one thing dimming cannot do. Costs a running animation on the critical path, and the design already asks that motion carry meaning or be removed.',
    css: `
      @keyframes paper-turn-pending-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.55; }
      }
      [data-option='pulse'] [data-paper-turn-pending='true'] sp-card {
        animation: paper-turn-pending-pulse 900ms ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        [data-option='pulse'] [data-paper-turn-pending='true'] sp-card {
          animation: none;
          opacity: 0.55;
        }
      }
    `,
  },
  {
    id: 'sweep',
    name: 'C — Progress sweep',
    verdict: 'Indeterminate progress, inside the tile bounds.',
    note: 'The most conventional loading signal, and the only one suggesting a process with a direction. A 3px bar on the tile\u2019s top edge, drawn with an absolutely positioned ::after so it claims no layout space. Needs overflow: hidden on the grid item to keep the travel clipped, which is a small production constraint the others do not carry.',
    css: `
      [data-option='sweep'] .card-grid-item { overflow: hidden; border-radius: 4px; }
      [data-option='sweep'] [data-paper-turn-pending='true']::after {
        content: '';
        position: absolute;
        inset-inline: 0;
        inset-block-start: 0;
        block-size: 4px;
        z-index: 2;
        background: linear-gradient(
          90deg,
          transparent 0%,
          var(--spectrum-accent-color-900, #1473e6) 35%,
          var(--spectrum-accent-color-900, #1473e6) 65%,
          transparent 100%
        );
        animation: paper-turn-pending-sweep 1100ms ease-in-out infinite;
      }
      @keyframes paper-turn-pending-sweep {
        from { transform: translateX(-100%); }
        to { transform: translateX(100%); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-option='sweep'] [data-paper-turn-pending='true']::after {
          animation: none;
          background: var(--spectrum-accent-color-900, #1473e6);
          opacity: 0.6;
        }
      }
    `,
  },
  {
    id: 'spinner',
    name: 'D — Corner spinner',
    verdict: 'Included to be ruled out, not chosen.',
    note: 'The obvious answer and the worst fit. It draws a second focal point onto a tile that is about to become the whole page, and it is the most likely of the four to read as a glitch if it flashes on a warm activation. It sits top-right to stay clear of the anchor label, which is top-left \u2014 so the two do not collide, but the tile then has chrome in both corners.',
    css: `
      [data-option='spinner'] [data-paper-turn-pending='true']::after {
        content: '';
        position: absolute;
        inset-block-start: 12px;
        inset-inline-end: 12px;
        inline-size: 18px;
        block-size: 18px;
        z-index: 2;
        border: 2px solid rgb(255 255 255 / 45%);
        border-block-start-color: #fff;
        border-radius: 50%;
        animation: paper-turn-pending-spin 700ms linear infinite;
      }
      @keyframes paper-turn-pending-spin {
        to { transform: rotate(360deg); }
      }
    `,
  },
];

const PAGE_CSS = `
  body { margin: 0; background: #f5f5f5; }
  .mock-shell {
    padding: 32px clamp(16px, 4vw, 48px) 64px;
    font-family: adobe-clean, 'Source Sans Pro', -apple-system, system-ui, sans-serif;
    color: #2c2c2c;
  }
  .mock-shell > h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .mock-shell > p.lede { margin: 0 0 32px; color: #6e6e6e; max-width: 62ch; }
  .mock-option { margin-block-end: 44px; }
  .mock-option h2 { font-size: 1.05rem; margin: 0 0 2px; }
  .mock-option .verdict { margin: 0 0 6px; font-weight: 600; }
  .mock-option .note { margin: 0 0 16px; color: #6e6e6e; max-width: 68ch; font-size: 0.9rem; line-height: 1.5; }
  .mock-legend { font-size: 0.8rem; color: #6e6e6e; margin-block-start: 8px; }
  /* Two tiles per option: the first pending, the second idle for comparison. */
  .mock-option .card-grid { --grid-columns: 3; max-width: 900px; }
`;

function tile(document: Document, index: number, pending: boolean): HTMLElement {
  const card = cards[index];
  if (!card) throw new Error(`no card at ${index}`);

  const item = document.createElement('li');
  item.className = 'card-grid-item';
  if (pending) {
    item.setAttribute('data-paper-turn-pending', 'true');
  }

  // Matches `createCardItem`: an anchor trigger, slotted heading and subheading so the
  // capture reproduces them, and the anchor label as a sibling.
  const trigger = document.createElement('a');
  trigger.className = 'card-trigger';
  trigger.setAttribute('data-card-trigger', '');
  trigger.href = card.url;
  if (pending) {
    trigger.setAttribute('data-paper-turn-pending', 'true');
    trigger.setAttribute('aria-busy', 'true');
  }

  const cardElement = document.createElement('sp-card');
  cardElement.setAttribute('heading', card.title);
  cardElement.setAttribute('subheading', card.subtitle);
  cardElement.setAttribute('size', 's');

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
  trigger.append(cardElement);

  const label = document.createElement('span');
  label.className = 'tile-anchor-label';
  label.setAttribute('data-paper-turn-anchor-label', 'true');
  label.setAttribute('aria-hidden', 'true');
  label.textContent = 'top-left';

  item.append(trigger, label);
  return item;
}

const root = document.querySelector<HTMLElement>('#mock');
if (!root) throw new Error('missing #mock');

const style = document.createElement('style');
style.textContent = PAGE_CSS + OPTIONS.map((option) => option.css).join('\n');
document.head.append(style);

root.innerHTML = `
  <sp-theme system="spectrum" color="light" scale="medium">
    <div class="mock-shell">
      <h1>Pending affordance — four candidates</h1>
      <p class="lede">
        Phase 2 open question 2. Each row shows one treatment: the left tile is pending,
        the middle and right tiles are idle for comparison. Real <code>sp-card</code>,
        real <code>styles.css</code>, real tokens. No candidate changes box size,
        position, or margin.
      </p>
      <div data-rows></div>
    </div>
  </sp-theme>
`;

const rows = root.querySelector<HTMLElement>('[data-rows]');
if (!rows) throw new Error('missing rows');

for (const option of OPTIONS) {
  const section = document.createElement('section');
  section.className = 'mock-option';
  section.setAttribute('data-option', option.id);

  const title = document.createElement('h2');
  title.textContent = option.name;

  const verdict = document.createElement('p');
  verdict.className = 'verdict';
  verdict.textContent = option.verdict;

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = option.note;

  const grid = document.createElement('ul');
  grid.className = 'card-grid';
  // Labels on, because two candidates place chrome in a tile corner and the label's own
  // corner is part of judging that.
  grid.setAttribute('data-anchor-labels', 'true');
  grid.append(tile(document, 0, true), tile(document, 1, false), tile(document, 2, false));

  const legend = document.createElement('p');
  legend.className = 'mock-legend';
  legend.textContent = 'Left tile pending · middle and right idle';

  section.append(title, verdict, note, grid, legend);
  rows.append(section);
}
