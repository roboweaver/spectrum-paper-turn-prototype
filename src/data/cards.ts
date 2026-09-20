export interface CardSection {
  heading: string;
  body: string;
}

export interface CardRecord {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  /**
   * The detail page this tile opens, as a path relative to the index document.
   *
   * Must be same-origin once resolved against the document base URL: the
   * transition adopts real DOM from this URL, and a cross-origin document
   * cannot be adopted. Relative rather than root-absolute so one build works at
   * a domain root, under the GitHub Pages subpath, and from the filesystem — the
   * same reason `vite.config.ts` sets `base: './'`.
   */
  url: string;
  /** Body copy for the detail page. Consumed by `scripts/generate-detail-pages.ts`
   *  to emit the page at `url`; no longer read when a transition opens. */
  sections: readonly CardSection[];
  /** Printed at the very bottom of the detail page so the sheet's trailing
   *  edge is identifiable mid-turn. Generator input, as with `sections`. */
  footer: string;
}

/** Directory, relative to the site root, holding the generated detail pages. */
export const DETAIL_PAGE_DIR = 'detail';

/**
 * The detail page path for a record id.
 *
 * Both sides of the contract call this — the records below for their `url`, and
 * the generator for its output filename — so a tile cannot come to point at a
 * page that was never emitted.
 */
export function detailPagePath(id: string): string {
  return `${DETAIL_PAGE_DIR}/${id}.html`;
}

/**
 * The demo tiles, in grid order, without their derived `url`.
 *
 * Sixteen of them, because the grab anchor is resolved from the tile's position
 * in the grid and sixteen is what a 4 x 4 needs. The demo shows the first `n` of
 * these, where `n` is the tile count control's value, so the first three records
 * are the three the prototype has always opened with.
 */
const cardData: readonly Omit<CardRecord, 'url'>[] = [
  {
    id: 'spectrum',
    title: 'Spectrum foundations',
    subtitle: 'Design system',
    description: 'Color, typography, and layout for coherent product experiences.',
    color: '#5c5ce0',
    sections: [
      {
        heading: 'Color',
        body: 'Semantic tokens map every surface, border, and text colour to a role rather than a fixed value, so the same component reads correctly in light and dark themes.',
      },
      {
        heading: 'Typography',
        body: 'A single type ramp drives headings, body copy, and captions. Sizes step on a consistent scale so density can change without redrawing the hierarchy.',
      },
      {
        heading: 'Layout',
        body: 'Spacing tokens keep rhythm predictable across breakpoints. Components claim space from the same scale, which keeps unrelated screens feeling related.',
      },
    ],
    footer: 'Bottom of the Spectrum foundations page',
  },
  {
    id: 'workflow',
    title: 'Workflow patterns',
    subtitle: 'Interaction',
    description: 'Predictable controls and feedback for focused creative work.',
    color: '#d83790',
    sections: [
      {
        heading: 'Controls',
        body: 'Every control states what it will do before it is pressed and confirms what happened afterwards, so a long editing session never depends on memory.',
      },
      {
        heading: 'Feedback',
        body: 'Progress, success, and failure share one vocabulary. A slow operation reports itself the same way whether it takes a moment or several minutes.',
      },
      {
        heading: 'Recovery',
        body: 'Destructive actions are reversible wherever possible, and where they are not, the confirmation names the exact thing about to be lost.',
      },
    ],
    footer: 'Bottom of the Workflow patterns page',
  },
  {
    id: 'content',
    title: 'Content surfaces',
    subtitle: 'Presentation',
    description: 'Responsive structures that preserve hierarchy across devices.',
    color: '#268e6c',
    sections: [
      {
        heading: 'Structure',
        body: 'Content is grouped before it is styled. The reading order in the markup matches the visual order, which keeps assistive technology in step with sighted use.',
      },
      {
        heading: 'Density',
        body: 'The same content adapts from a wide desktop canvas to a narrow phone column by dropping decoration first and never dropping meaning.',
      },
      {
        heading: 'Media',
        body: 'Images and video sit inside the layout grid rather than breaking it, so a page keeps its shape while assets stream in at different rates.',
      },
    ],
    footer: 'Bottom of the Content surfaces page',
  },
  {
    id: 'layers',
    title: 'Layer model',
    subtitle: 'Structure',
    description: 'Elevation, overlays, and stacking that never trap the reader.',
    color: '#0d66d0',
    sections: [
      {
        heading: 'Elevation',
        body: 'Each layer earns its shadow from how far it sits above the page, so depth reads as hierarchy rather than decoration.',
      },
      {
        heading: 'Overlays',
        body: 'An overlay owns focus for as long as it is open and hands it straight back to whatever opened it when it closes.',
      },
      {
        heading: 'Stacking',
        body: 'Stacking contexts are declared in one place, so a new surface cannot quietly slide underneath an existing one.',
      },
    ],
    footer: 'Bottom of the Layer model page',
  },
  {
    id: 'motion',
    title: 'Motion principles',
    subtitle: 'Animation',
    description: 'Movement that explains where a thing came from and went.',
    color: '#e34850',
    sections: [
      {
        heading: 'Continuity',
        body: 'An element that becomes another element moves there rather than being replaced, so the relationship survives the change.',
      },
      {
        heading: 'Duration',
        body: 'Short distances finish quickly and long ones take longer, which keeps perceived speed constant across screen sizes.',
      },
      {
        heading: 'Restraint',
        body: 'Motion carries meaning or it is removed, and every motion has a reduced-motion equivalent that says the same thing.',
      },
    ],
    footer: 'Bottom of the Motion principles page',
  },
  {
    id: 'tokens',
    title: 'Design tokens',
    subtitle: 'Foundations',
    description: 'One source of truth shared by design tools and code.',
    color: '#9256d9',
    sections: [
      {
        heading: 'Naming',
        body: 'A token names the role it plays, not the value it holds, so the value can change without a rename rippling through the product.',
      },
      {
        heading: 'Layers',
        body: 'Global tokens feed component tokens, and only the component layer is consumed directly, which keeps overrides local.',
      },
      {
        heading: 'Delivery',
        body: 'The same token set is published for CSS, native platforms, and design tools from one build, so no platform drifts.',
      },
    ],
    footer: 'Bottom of the Design tokens page',
  },
  {
    id: 'accessibility',
    title: 'Accessible by default',
    subtitle: 'Inclusion',
    description: 'Keyboard, focus, and assistive technology as first-class paths.',
    color: '#147af3',
    sections: [
      {
        heading: 'Keyboard',
        body: 'Every action is reachable with a keyboard, in an order that matches the visual layout without a single tab trap.',
      },
      {
        heading: 'Focus',
        body: 'Focus is always visible and always somewhere sensible, including immediately after a surface opens or closes.',
      },
      {
        heading: 'Semantics',
        body: 'Roles and names come from real elements wherever possible, so assistive technology reads the page without a parallel description.',
      },
    ],
    footer: 'Bottom of the Accessible by default page',
  },
  {
    id: 'typography',
    title: 'Type scale',
    subtitle: 'Foundations',
    description: 'One ramp driving headings, body copy, and captions.',
    color: '#bd6100',
    sections: [
      {
        heading: 'Ramp',
        body: 'Sizes step on a fixed ratio, so a heading two levels up is recognisable as such without measuring it.',
      },
      {
        heading: 'Rhythm',
        body: 'Line height is derived from size rather than chosen per block, which keeps paragraphs aligned across columns.',
      },
      {
        heading: 'Density',
        body: 'The ramp shifts as a whole between comfortable and compact, so hierarchy survives a change of density.',
      },
    ],
    footer: 'Bottom of the Type scale page',
  },
  {
    id: 'iconography',
    title: 'Iconography',
    subtitle: 'Assets',
    description: 'A drawn vocabulary that stays legible at every size.',
    color: '#2680eb',
    sections: [
      {
        heading: 'Grid',
        body: 'Icons are drawn on a shared grid with a shared stroke weight, so a row of them reads as one set rather than a collection.',
      },
      {
        heading: 'Sizes',
        body: 'Each icon is drawn at the sizes it ships in rather than scaled, because a scaled stroke thins out and loses its shape.',
      },
      {
        heading: 'Meaning',
        body: 'An icon never carries meaning alone: it labels an action that is also named, or it is marked decorative.',
      },
    ],
    footer: 'Bottom of the Iconography page',
  },
  {
    id: 'data-viz',
    title: 'Data visualization',
    subtitle: 'Analysis',
    description: 'Charts that answer a question before they decorate a page.',
    color: '#00a0a0',
    sections: [
      {
        heading: 'Encoding',
        body: 'Position carries the primary comparison, with colour and size reserved for the dimensions that tolerate less precision.',
      },
      {
        heading: 'Palettes',
        body: 'Categorical, sequential, and diverging palettes are distinct sets, and none of them relies on hue alone to separate series.',
      },
      {
        heading: 'Honesty',
        body: 'Axes state their baseline and their units, so a chart cannot exaggerate a difference by cropping it.',
      },
    ],
    footer: 'Bottom of the Data visualization page',
  },
  {
    id: 'forms',
    title: 'Form patterns',
    subtitle: 'Input',
    description: 'Fields, validation, and errors that respect the reader.',
    color: '#da3b01',
    sections: [
      {
        heading: 'Labels',
        body: 'Every field has a persistent label, because a placeholder disappears exactly when it is most needed.',
      },
      {
        heading: 'Validation',
        body: 'Errors arrive when the reader has finished, name the field, and say what would be accepted instead.',
      },
      {
        heading: 'Progress',
        body: 'Long forms save as they go and say what is left, so leaving the page never means starting again.',
      },
    ],
    footer: 'Bottom of the Form patterns page',
  },
  {
    id: 'navigation',
    title: 'Navigation shells',
    subtitle: 'Structure',
    description: 'Ways in and out that stay oriented at every width.',
    color: '#6767ec',
    sections: [
      {
        heading: 'Orientation',
        body: 'The shell always states where the reader is, so a deep link lands somewhere that explains itself.',
      },
      {
        heading: 'Adaptation',
        body: 'A rail becomes a drawer becomes a bar as width runs out, and the same destinations survive each change.',
      },
      {
        heading: 'History',
        body: 'Back does what the reader expects because navigation is real navigation, not state hidden inside a component.',
      },
    ],
    footer: 'Bottom of the Navigation shells page',
  },
  {
    id: 'theming',
    title: 'Theming',
    subtitle: 'Appearance',
    description: 'Light, dark, and contrast from one set of decisions.',
    color: '#1b1b1b',
    sections: [
      {
        heading: 'Roles',
        body: 'Surfaces, borders, and text take their colour from a role, so swapping a theme never asks a component to be rewritten.',
      },
      {
        heading: 'Contrast',
        body: 'Every pairing is checked against its own background, and the high-contrast theme is a supported theme rather than a filter.',
      },
      {
        heading: 'Scoping',
        body: 'A theme applies to a subtree, so a preview can show one appearance inside a page rendered in another.',
      },
    ],
    footer: 'Bottom of the Theming page',
  },
  {
    id: 'performance',
    title: 'Performance budgets',
    subtitle: 'Engineering',
    description: 'Limits agreed up front rather than measured after release.',
    color: '#0f797d',
    sections: [
      {
        heading: 'Budgets',
        body: 'Bytes, frames, and interaction latency each get a number, and a change that exceeds one is a decision rather than a surprise.',
      },
      {
        heading: 'Measurement',
        body: 'The numbers come from the devices the product is actually used on, not from the machine the code was written on.',
      },
      {
        heading: 'Regression',
        body: 'Budgets are asserted in continuous integration, so drift fails a named check instead of accumulating quietly.',
      },
    ],
    footer: 'Bottom of the Performance budgets page',
  },
  {
    id: 'localization',
    title: 'Localization',
    subtitle: 'Reach',
    description: 'Layouts that survive translation and mirroring.',
    color: '#c94f0f',
    sections: [
      {
        heading: 'Length',
        body: 'Space is reserved for text that grows by a third under translation, so a label wraps rather than overflowing its control.',
      },
      {
        heading: 'Direction',
        body: 'Layout uses logical properties throughout, so a right-to-left locale mirrors without a second stylesheet.',
      },
      {
        heading: 'Formats',
        body: 'Dates, numbers, and names are formatted by locale rather than assembled from fragments that only read correctly in one.',
      },
    ],
    footer: 'Bottom of the Localization page',
  },
  {
    id: 'testing',
    title: 'Testing surfaces',
    subtitle: 'Quality',
    description: 'Hooks that make behaviour observable without pinning pixels.',
    color: '#5aa2f7',
    sections: [
      {
        heading: 'Contracts',
        body: 'Components publish the state a test needs to read, so a test asserts behaviour rather than scraping a class name.',
      },
      {
        heading: 'Layers',
        body: 'Pure logic is tested as pure logic, interaction in a real browser, and appearance by screenshot — each at the cheapest layer that can see the failure.',
      },
      {
        heading: 'Determinism',
        body: 'Clocks, randomness, and network calls are injectable, so a failing test fails again for the same reason.',
      },
    ],
    footer: 'Bottom of the Testing surfaces page',
  },
] as const;

/**
 * The demo tiles, in grid order, each addressing its own detail page.
 *
 * `url` is derived rather than authored so it cannot drift from `id`, which is
 * what the generator names its output after.
 */
export const cards: readonly CardRecord[] = cardData.map((card) => ({
  ...card,
  url: detailPagePath(card.id),
}));

export function cardById(id: string): CardRecord {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return card;
}
