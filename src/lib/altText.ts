import type { Artifact } from '@/data/schema';

/**
 * Alternative text for the photograph.
 *
 * Before the reveal this describes the object without identifying it, using only
 * the same clues a sighted player can see. Afterwards it names it, because by then
 * the name is the point.
 */
export function altText(artifact: Artifact, nameRevealed: boolean): string {
  if (nameRevealed) return `Photograph of ${artifact.title}`;
  const kind = artifact.objectType?.toLowerCase();
  return kind
    ? `Photograph of the artifact for this round: a ${kind}`
    : 'Photograph of the artifact for this round';
}
