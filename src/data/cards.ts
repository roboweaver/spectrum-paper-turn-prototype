export interface CardRecord {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
}

export const cards: readonly CardRecord[] = [
  {
    id: 'spectrum',
    title: 'Spectrum foundations',
    subtitle: 'Design system',
    description: 'Color, typography, and layout for coherent product experiences.',
    color: '#5c5ce0',
  },
  {
    id: 'workflow',
    title: 'Workflow patterns',
    subtitle: 'Interaction',
    description: 'Predictable controls and feedback for focused creative work.',
    color: '#d83790',
  },
  {
    id: 'content',
    title: 'Content surfaces',
    subtitle: 'Presentation',
    description: 'Responsive structures that preserve hierarchy across devices.',
    color: '#268e6c',
  },
] as const;

export function cardById(id: string): CardRecord {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return card;
}
