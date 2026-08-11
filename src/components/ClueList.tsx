import type { ReactNode } from 'react';
import { Hammer, Layers, Shapes, Users } from 'lucide-react';
import type { Artifact } from '@/data/schema';
import { eraLabel, eraOf, formatYearRange } from '@/game/eras';
import { isClueVisible, type DifficultyId } from '@/game/selection';
import { Chip } from './ui/primitives';

/**
 * Pre-guess clues.
 *
 * Difficulty is expressed *here* rather than by making the controls harder: an
 * Explorer sees the culture and the date, an Expert sees only what kind of object
 * it is. Nothing in this list may name a place — that would give the answer away —
 * which is why `culture` is included but `origin` never is.
 */
export function ClueList({
  artifact,
  difficulty,
  className,
}: {
  artifact: Artifact;
  difficulty: DifficultyId;
  className?: string;
}) {
  const era = eraOf(artifact);
  const dateText =
    artifact.dateDisplay ?? formatYearRange(artifact.yearStart, artifact.yearEnd) ?? null;

  const clues: Array<{ key: string; label: string; value: string; icon: ReactNode }> = [];

  if (isClueVisible(difficulty, 'objectType') && artifact.objectType) {
    clues.push({
      key: 'type',
      label: 'Object',
      value: artifact.objectType,
      icon: <Shapes size={13} aria-hidden />,
    });
  }
  if (isClueVisible(difficulty, 'era') && era) {
    clues.push({
      key: 'era',
      label: 'Era',
      value: eraLabel(era),
      icon: <Layers size={13} aria-hidden />,
    });
  }
  if (isClueVisible(difficulty, 'date') && dateText) {
    clues.push({
      key: 'date',
      label: 'Date',
      value: dateText,
      icon: <Layers size={13} aria-hidden />,
    });
  }
  if (isClueVisible(difficulty, 'culture') && artifact.culture) {
    clues.push({
      key: 'culture',
      label: 'Culture',
      value: artifact.culture,
      icon: <Users size={13} aria-hidden />,
    });
  }
  if (isClueVisible(difficulty, 'material') && artifact.material) {
    clues.push({
      key: 'material',
      label: 'Made of',
      value: artifact.material,
      icon: <Hammer size={13} aria-hidden />,
    });
  }

  if (clues.length === 0) {
    return (
      <p className={className}>
        <span className="text-sm text-ink-3">
          No clues on this difficulty — go by the object alone.
        </span>
      </p>
    );
  }

  return (
    <ul className={className}>
      {clues.map((clue) => (
        <li key={clue.key} className="inline-block max-w-full">
          <Chip label={clue.label} icon={clue.icon}>
            {clue.value}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
