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
  { id: 'prehistoric', label: 'Prehistory', range: 'before 3000 BCE', max: -3001 },
  { id: 'bronze', label: 'Bronze Age', range: '3000–1200 BCE', max: -1200 },
  { id: 'classical', label: 'Classical Antiquity', range: '1200 BCE – 300 CE', max: 300 },
  { id: 'late-antique', label: 'Late Antiquity', range: '300 – 1000 CE', max: 1000 },
  { id: 'medieval', label: 'Medieval & After', range: '1000 – 1700 CE', max: 1700 },
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
