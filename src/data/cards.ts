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
  /** Body copy for the detail page, so the sheet carries readable text from
   *  top to bottom while it turns. */
  sections: readonly CardSection[];
  /** Printed at the very bottom of the detail page so the sheet's trailing
   *  edge is identifiable mid-turn. */
  footer: string;
}

export const cards: readonly CardRecord[] = [
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
] as const;

export function cardById(id: string): CardRecord {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return card;
}
