import type { Artifact } from '../../src/data/schema.js';
import { isPlayableTier } from './geoTiers.js';

/**
 * Objects outside the game's scope. Matched against title, object type and
 * classification.
 *
 * Two categories are excluded:
 *
 * - **Not portable artifacts.** A standing building or a landscape photograph
 *   is not something a player can reason about from a photo of the object.
 * - **Modern material.** Museum "ancient art" departments still contain plaster
 *   casts, 19th-century reproductions and excavation photographs, all of which
 *   would be scored against an ancient origin they never had.
 */
const EXCLUDED_TYPE_PATTERNS = [
  /\bphotograph|negative|glass plate|daguerreotype|postcard\b/i,
  /\bcast\b|\belectrotype\b|\breproduction\b|\bfacsimile\b|\breplica\b/i,
  /\bdrawing of|watercolour of|watercolor of|engraving of|print after\b/i,
  /\bbuilding|architecture$|house$|church$|cathedral$|mosque$|bridge$\b/i,
  /\bmap\b|\bblueprint\b|\barchitectural (?:drawing|plan|model)\b/i,
  /\bbanknote|postage stamp|coin die|medal, modern\b/i,
];

const EXCLUDED_TITLE_PATTERNS = [
  /\bafter the original\b/i,
  /\bmodern copy\b/i,
  /\bnot on view\b/i,
  /*
   * Catalogue references masquerading as titles. Wikidata contains items whose
   * English label is a holding institution plus an inventory number — "Musée
   * Saint-Raymond, 26102" — which tells a player nothing about the object and
   * reads as a bug on the results screen.
   */
  /(?:museum|musée|museo|collection|gallery|institute)\b[^,]*,\s*\d{3,}/i,
  /\b(?:inv|inv\.|no|nr|cat)\.?\s*\d{3,}\s*$/i,
  /^\s*[\d\s.,/-]+$/,
];

/** Latest creation year still considered in scope. */
export const MAX_YEAR = 1700;
/** Earliest plausible year; anything before is almost always a data error. */
export const MIN_YEAR = -1_000_000;

export interface RejectionReason {
  id: string;
  detail?: string;
}

/**
 * Gate applied to every normalized record before it can become a round.
 *
 * Returning a reason rather than a boolean means the ingest summary can show
 * *why* records were dropped, which is how you notice an adapter regression.
 */
export function rejectArtifact(artifact: Artifact): RejectionReason | null {
  if (!artifact.image.url) return { id: 'no-image' };
  if (!/^https:\/\//.test(artifact.image.url)) return { id: 'insecure-image' };

  if (!isPlayableTier(artifact.origin.tier)) {
    return { id: 'coordinate-too-coarse', detail: artifact.origin.tier };
  }
  /*
   * Confidence floor.
   *
   * Set just below the lowest *legitimate* combination, which is a cultural
   * heartland inferred from a culture name: culture-region (0.42) × cultural-origin
   * (0.8) × rough precision (0.85) = 0.286. A floor of 0.35 silently discarded every
   * culture-derived origin — including the Moche bottle this threshold was never
   * meant to exclude.
   *
   * Quality is now enforced where it belongs: `isPlayableTier` rejects country
   * centroids, the culture table refuses cultures it cannot place, and the resolver
   * rejects weak matches outright. This floor only catches degenerate leftovers.
   */
  if (artifact.origin.confidence < 0.28) {
    return { id: 'low-confidence', detail: artifact.origin.confidence.toFixed(2) };
  }

  const haystack = [artifact.title, artifact.objectType, ...artifact.tags]
    .filter(Boolean)
    .join(' | ');
  for (const pattern of EXCLUDED_TYPE_PATTERNS) {
    if (pattern.test(haystack))
      return { id: 'out-of-scope-type', detail: artifact.objectType ?? '' };
  }
  for (const pattern of EXCLUDED_TITLE_PATTERNS) {
    if (pattern.test(artifact.title)) return { id: 'out-of-scope-title' };
  }

  const year = artifact.yearEnd ?? artifact.yearStart;
  if (year != null && (year > MAX_YEAR || year < MIN_YEAR)) {
    return { id: 'out-of-period', detail: String(year) };
  }

  // A round needs *something* to talk about on the reveal screen.
  const facts = [artifact.culture, artifact.period, artifact.dateDisplay, artifact.material].filter(
    Boolean,
  ).length;
  if (facts === 0 && !artifact.description) return { id: 'no-metadata' };

  if (artifact.title.trim().length < 3) return { id: 'no-title' };

  return null;
}

/**
 * Composite 0–1 quality score. Used to break ties during deduplication and to
 * bias selection towards records that will produce a good reveal screen.
 */
export function qualityScore(artifact: Artifact): number {
  let score = 0;
  score += artifact.origin.confidence * 0.4;
  if (artifact.description) score += 0.15;
  if (artifact.culture) score += 0.1;
  if (artifact.dateDisplay || artifact.yearStart != null) score += 0.1;
  if (artifact.material) score += 0.07;
  if (artifact.objectType) score += 0.05;
  if (artifact.period) score += 0.05;
  if (artifact.discovery) score += 0.05;
  if (artifact.image.width && artifact.image.width >= 600) score += 0.03;
  return Number(Math.min(1, score).toFixed(3));
}

/**
 * How recognisable an object is, 0–1. Drives the difficulty tiers: Explorer
 * needs objects a non-specialist has plausibly seen before.
 *
 * There is no ground truth for fame, so this combines the signals providers do
 * expose: curatorial highlight flags, how much has been written about the
 * object, and whether it has a proper name rather than a generic type label.
 */
export interface FameSignals {
  /** Provider marks it a highlight / masterpiece. */
  isHighlight?: boolean;
  /** Number of images the provider holds; heavily-photographed = important. */
  imageCount?: number;
  /** Wikipedia/Wikidata sitelink count, when available. */
  sitelinks?: number;
  hasDescription?: boolean;
  title: string;
}

const GENERIC_TITLE =
  /^(fragment|sherd|shard|bead|vessel|bowl|jar|cup|lamp|nail|weight|ring|tool|blade|figurine|statuette|relief|seal|coin|tile|brick|amulet|scarab|ostracon|papyrus)\b/i;

export function fameScore(signals: FameSignals): number {
  let score = 0.1;
  if (signals.isHighlight) score += 0.45;
  if (signals.hasDescription) score += 0.12;

  const images = signals.imageCount ?? 0;
  if (images >= 12) score += 0.2;
  else if (images >= 5) score += 0.12;
  else if (images >= 2) score += 0.06;

  const sitelinks = signals.sitelinks ?? 0;
  if (sitelinks >= 25) score += 0.4;
  else if (sitelinks >= 10) score += 0.28;
  else if (sitelinks >= 4) score += 0.16;
  else if (sitelinks >= 1) score += 0.08;

  // A named object ("Sphinx of Hatshepsut") is more recognisable than a type
  // label ("Fragment of a bowl").
  if (GENERIC_TITLE.test(signals.title.trim())) score -= 0.12;
  else if (/^[A-Z]/.test(signals.title.trim()) && signals.title.split(/\s+/).length <= 6)
    score += 0.06;

  return Number(Math.min(1, Math.max(0, score)).toFixed(3));
}
