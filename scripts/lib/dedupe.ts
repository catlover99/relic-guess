import type { Artifact } from '../../src/data/schema.js';
import { distanceKm } from '../../src/game/geo.js';
import { titleKey } from './text.js';

export interface DedupeResult {
  kept: Artifact[];
  removed: Array<{ id: string; duplicateOf: string; rule: string }>;
}

/**
 * Distance below which two same-titled objects are assumed to be the same
 * object rather than two similar objects from neighbouring sites.
 */
const SAME_PLACE_KM = 120;

function accessionKey(artifact: Artifact): string | null {
  if (!artifact.accessionNumber) return null;
  const normalized = artifact.accessionNumber.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized.length >= 4 ? `${artifact.provider}:${normalized}` : null;
}

/** Rough century bucket — two records of the same object rarely disagree by more. */
function eraBucket(artifact: Artifact): string {
  const year = artifact.yearStart ?? artifact.yearEnd;
  return year == null ? 'unknown' : String(Math.round(year / 100));
}

/**
 * Removes duplicate records.
 *
 * Duplicates arise two ways and need different rules:
 *
 * 1. **Within a provider.** The same object appears under several ids, or a
 *    paginated harvest overlaps itself. Provider id and accession number catch
 *    these exactly.
 * 2. **Across providers.** Wikidata and the Met both describe the Rosetta Stone.
 *    There is no shared identifier, so we fall back to a normalized title plus
 *    corroborating evidence (same era, nearby origin, or identical image URL) —
 *    title alone would collapse every object called "Amulet".
 *
 * When two records match, the higher-quality one wins so the surviving record is
 * the one with the better coordinate and richer metadata.
 */
export function dedupe(artifacts: readonly Artifact[]): DedupeResult {
  // Best-first, so the first record encountered for a key is the keeper.
  const ordered = [...artifacts].sort((a, b) => b.quality - a.quality || b.fame - a.fame);

  const kept: Artifact[] = [];
  const removed: DedupeResult['removed'] = [];

  const byId = new Set<string>();
  const byAccession = new Map<string, string>();
  const byImage = new Map<string, string>();
  const byTitle = new Map<string, Artifact[]>();

  for (const artifact of ordered) {
    if (byId.has(artifact.id)) {
      removed.push({ id: artifact.id, duplicateOf: artifact.id, rule: 'duplicate-id' });
      continue;
    }

    const accession = accessionKey(artifact);
    if (accession && byAccession.has(accession)) {
      removed.push({
        id: artifact.id,
        duplicateOf: byAccession.get(accession)!,
        rule: 'accession-number',
      });
      continue;
    }

    // Identical image URL is conclusive: the same file cannot depict two objects.
    if (byImage.has(artifact.image.url)) {
      removed.push({
        id: artifact.id,
        duplicateOf: byImage.get(artifact.image.url)!,
        rule: 'image-url',
      });
      continue;
    }

    const key = titleKey(artifact.title);
    const siblings = key.length >= 4 ? (byTitle.get(key) ?? []) : [];
    const crossMatch = siblings.find((existing) => {
      const nearby = distanceKm(existing.origin, artifact.origin) <= SAME_PLACE_KM;
      const sameEra = eraBucket(existing) === eraBucket(artifact);
      const sameCulture =
        existing.culture && artifact.culture
          ? existing.culture.toLowerCase() === artifact.culture.toLowerCase()
          : false;
      // Within one provider a repeated title plus a nearby origin is enough.
      if (existing.provider === artifact.provider) return nearby && sameEra;
      // Across providers require two independent corroborations.
      return nearby && (sameEra || sameCulture);
    });

    if (crossMatch) {
      removed.push({
        id: artifact.id,
        duplicateOf: crossMatch.id,
        rule: existingRule(crossMatch, artifact),
      });
      continue;
    }

    kept.push(artifact);
    byId.add(artifact.id);
    if (accession) byAccession.set(accession, artifact.id);
    byImage.set(artifact.image.url, artifact.id);
    if (key.length >= 4) byTitle.set(key, [...siblings, artifact]);
  }

  return { kept, removed };
}

function existingRule(existing: Artifact, candidate: Artifact): string {
  return existing.provider === candidate.provider ? 'same-provider-title' : 'cross-provider-title';
}
