import type { Artifact } from '@/data/schema';

/**
 * Broad historical eras, used for period-locked modes and for keeping a session
 * from being five Roman rounds. Boundaries are conventional round numbers, not
 * claims about universal periodisation — an era is assigned from the *midpoint*
 * of the object's date range.
 *
 * `max` is the last year *inside* each era, so the boundaries read the way the
 * labels do: 3000 BCE belongs to the Bronze Age, not to Prehistory.
 */
export const ERAS = [
  { id: 'prehistoric', label: 'Prehistory', range: 'before c. 3000 BCE', max: -3001 },
  { id: 'bronze', label: 'Bronze Age', range: 'c. 3000–1200 BCE', max: -1200 },
  { id: 'classical', label: 'Classical Antiquity', range: 'c. 1200 BCE – 300 CE', max: 300 },
  { id: 'late-antique', label: 'Late Antiquity', range: 'c. 300–1000 CE', max: 1000 },
  { id: 'medieval', label: 'Medieval & Later', range: 'c. 1000–1700 CE', max: 1700 },
] as const;

export type EraId = (typeof ERAS)[number]['id'];

export function eraOf(artifact: Pick<Artifact, 'yearStart' | 'yearEnd'>): EraId | null {
  const { yearStart, yearEnd } = artifact;
  if (yearStart == null && yearEnd == null) return null;
  const mid =
    yearStart != null && yearEnd != null ? (yearStart + yearEnd) / 2 : (yearStart ?? yearEnd)!;
  return (ERAS.find((e) => mid <= e.max) ?? ERAS[ERAS.length - 1]!).id;
}

export function eraLabel(id: EraId | null): string {
  return ERAS.find((e) => e.id === id)?.label ?? 'Undated';
}

/** The era's approximate span, e.g. "c. 1200 BCE – 300 CE". */
export function eraRange(id: EraId | null): string | null {
  return ERAS.find((e) => e.id === id)?.range ?? null;
}

/**
 * An era named together with when it was: "Classical Antiquity · c. 1200 BCE – 300 CE".
 *
 * Players told us that "Classical Antiquity" and "Medieval & Later" mean nothing
 * chronologically unless you already know the answer, which defeats the point of
 * showing them. The range always comes from `ERAS` — the one definition the game
 * has — so no component can drift into quoting slightly different dates.
 *
 * The "c." is not decoration: these boundaries are conventional round numbers.
 * An artifact's own recorded date is always the more precise statement and is
 * shown separately; this is background, not a correction to it.
 */
export function eraWithRange(id: EraId | null): string {
  const era = ERAS.find((e) => e.id === id);
  if (!era) return 'Undated';
  return `${era.label} · ${era.range}`;
}

/** "1473–1458 BCE", "ca. 700 CE", "3200 BCE – 200 CE". */
export function formatYearRange(yearStart: number | null, yearEnd: number | null): string | null {
  if (yearStart == null && yearEnd == null) return null;
  const year = (y: number) => (y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`);
  if (yearStart == null) return year(yearEnd!);
  if (yearEnd == null) return year(yearStart);
  if (yearStart === yearEnd) return year(yearStart);
  // Same era: only annotate the second value ("1473–1458 BCE").
  if (yearStart < 0 === yearEnd < 0) {
    return `${Math.abs(yearStart)}–${year(yearEnd)}`;
  }
  return `${year(yearStart)} – ${year(yearEnd)}`;
}
