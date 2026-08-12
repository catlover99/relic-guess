import type { Artifact } from '@/data/schema';
import { distanceKm } from './geo';
import { eraOf, type EraId } from './eras';
import { regionOf, type RegionId } from './regions';
import { shuffle, type Rng } from './random';

/**
 * Modes, easiest first.
 *
 * A mode sets two independent things, and the second one is what makes Heartland
 * a different game rather than a longer clue list:
 *
 * 1. **How much you are told** — `clues`, and how obscure the objects get
 *    (`minFame`).
 * 2. **How precise an answer is being asked for** — `toleranceKm`, a radius
 *    forgiven by the scorer no matter how exact the museum's coordinate is.
 *
 * Most objects in the collection have no findspot at all; the honest question for
 * them is "where was this culture centred", and that is a question about a region
 * a few hundred kilometres across. Demanding trench-level precision by default
 * punished players for the dataset's own imprecision.
 */
export const DIFFICULTIES = [
  {
    id: 'heartland',
    label: 'Heartland',
    blurb: 'Name the region a culture was centred on. Era, date and culture shown.',
    /** One-line explanation of what counts as a right answer. */
    aim: 'Anywhere in the right region scores well — no need to find the dig site.',
    minFame: 0.3,
    /** Which metadata fields are visible pre-guess. */
    clues: ['objectType', 'culture', 'era', 'date', 'material'],
    toleranceKm: 300,
    /**
     * Graded against the culture's homeland, not the object's own findspot.
     *
     * This is what makes Heartland a different question rather than a lenient
     * version of the same one: "where was this culture centred" has a different
     * right answer from "where was this pot dug up", and the reveal shows both.
     * Artifacts whose culture the table does not cover fall back to their own
     * recorded place — see game/geography.ts.
     */
    scoresAgainst: 'heartland',
  },
  {
    id: 'scholar',
    label: 'Scholar',
    blurb: 'A broader mix. You see the era and what it is made of.',
    aim: 'Get within a country or so to score well.',
    minFame: 0.15,
    clues: ['objectType', 'era', 'material'],
    toleranceKm: 120,
    scoresAgainst: 'origin',
  },
  {
    id: 'expert',
    label: 'Expert',
    blurb: 'Anything in the collection. The object is your only clue.',
    aim: 'Scored against the recorded find or origin place itself.',
    minFame: 0,
    clues: ['objectType'],
    toleranceKm: 0,
    scoresAgainst: 'origin',
  },
] as const;

/** The mode a first-time player gets, and the one the daily challenge uses. */
export const DEFAULT_DIFFICULTY: DifficultyId = 'heartland';

export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];
export type ClueId = (typeof DIFFICULTIES)[number]['clues'][number];

export function difficulty(id: DifficultyId) {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}

/** The radius a mode forgives, for the scorer. */
export function toleranceFor(id: DifficultyId): number {
  return difficulty(id).toleranceKm;
}

export function isClueVisible(id: DifficultyId, clue: ClueId): boolean {
  return (difficulty(id).clues as readonly string[]).includes(clue);
}

export interface SelectionOptions {
  rounds: number;
  difficulty: DifficultyId;
  region?: RegionId | null;
  era?: EraId | null;
  /** Artifact ids seen recently; avoided unless the pool would run dry. */
  exclude?: readonly string[];
  rng: Rng;
}

/**
 * Minimum great-circle separation between two origins in the same session.
 * Without this, a pool containing ten objects from Susa happily serves all ten,
 * which is both boring and makes later rounds trivially guessable.
 */
const MIN_SEPARATION_KM = 600;

/** Per-session caps so one region or culture cannot dominate. */
function maxPerBucket(rounds: number): number {
  return Math.max(1, Math.ceil(rounds / 3));
}

interface Candidate {
  artifact: Artifact;
  region: RegionId | null;
  era: EraId | null;
  cultureKey: string;
}

function toCandidate(artifact: Artifact): Candidate {
  return {
    artifact,
    region: regionOf(artifact),
    era: eraOf(artifact),
    cultureKey: (artifact.culture ?? artifact.origin.country ?? artifact.id).toLowerCase(),
  };
}

/**
 * Phase one: which artifacts are eligible, and in what order.
 *
 * Split out from the diversity pass so callers can interleave work between the two —
 * specifically, so image verification can run over this fixed order before any
 * artifact is chosen. The order depends only on the seeded `rng`, which is what makes
 * the daily challenge reproducible. See game/session.ts.
 */
export function orderCandidates(pool: readonly Artifact[], options: SelectionOptions): Artifact[] {
  const excluded = new Set(options.exclude ?? []);
  const diff = difficulty(options.difficulty);

  const eligible = pool.filter((a) => {
    if (a.fame < diff.minFame) return false;
    if (options.region && regionOf(a) !== options.region) return false;
    if (options.era && eraOf(a) !== options.era) return false;
    return true;
  });

  // Prefer unseen artifacts, but keep seen ones as a tail so a small pool or a
  // long play session never produces a short round list.
  const unseen = eligible.filter((a) => !excluded.has(a.id));
  const seen = eligible.filter((a) => excluded.has(a.id));

  return [...shuffle(unseen, options.rng), ...shuffle(seen, options.rng)];
}

/**
 * Phase two: the diversity pass over an already-ordered candidate list.
 *
 * Pure and synchronous — given the same ordered input it always returns the same
 * rounds, which is what lets the session builder call it repeatedly as more
 * candidates are verified.
 */
export function pickDiverseRounds(
  candidateArtifacts: readonly Artifact[],
  rounds: number,
): Artifact[] {
  const ordered = candidateArtifacts.map(toCandidate);
  const cap = maxPerBucket(rounds);
  /*
   * Pass 1 enforces every constraint; each later pass loosens them. The final
   * pass must remove *all* caps, including the provider cap — a pool dominated by
   * one museum (which is the normal case early in a project's life) would
   * otherwise return a short session rather than a full one.
   */
  const passes = [
    { separation: MIN_SEPARATION_KM, cap, providerCap: Math.max(2, Math.ceil(rounds / 2)) },
    { separation: MIN_SEPARATION_KM / 3, cap: cap + 1, providerCap: rounds - 1 },
    { separation: 0, cap: Infinity, providerCap: Infinity },
  ];

  const chosen: Candidate[] = [];
  const used = new Set<string>();
  const regionCount = new Map<string, number>();
  const eraCount = new Map<string, number>();
  const cultureCount = new Map<string, number>();
  const providerCount = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const pass of passes) {
    for (const candidate of ordered) {
      if (chosen.length >= rounds) break;
      const { artifact } = candidate;
      if (used.has(artifact.id)) continue;

      const regionKey = candidate.region ?? 'unknown';
      const eraKey = candidate.era ?? 'unknown';

      if ((regionCount.get(regionKey) ?? 0) >= pass.cap) continue;
      if ((eraCount.get(eraKey) ?? 0) >= pass.cap) continue;
      if ((cultureCount.get(candidate.cultureKey) ?? 0) >= pass.cap) continue;
      if ((providerCount.get(artifact.provider) ?? 0) >= pass.providerCap) continue;

      const tooClose = chosen.some(
        (c) => distanceKm(c.artifact.origin, artifact.origin) < pass.separation,
      );
      if (tooClose) continue;

      chosen.push(candidate);
      used.add(artifact.id);
      bump(regionCount, regionKey);
      bump(eraCount, eraKey);
      bump(cultureCount, candidate.cultureKey);
      bump(providerCount, artifact.provider);
    }
    if (chosen.length >= rounds) break;
  }

  return chosen.slice(0, rounds).map((c) => c.artifact);
}

/**
 * Builds one session's worth of rounds, ignoring image availability.
 *
 * Retained for callers that do not need verification — tests, and the round-count
 * estimates on the start screen. The game itself goes through `buildSession`, which
 * verifies photographs before selecting.
 */
export function selectRounds(pool: readonly Artifact[], options: SelectionOptions): Artifact[] {
  return pickDiverseRounds(orderCandidates(pool, options), options.rounds);
}

/** How many rounds a given filter combination can actually support. */
export function countEligible(
  pool: readonly Artifact[],
  options: Pick<SelectionOptions, 'difficulty' | 'region' | 'era'>,
): number {
  const diff = difficulty(options.difficulty);
  return pool.filter(
    (a) =>
      a.fame >= diff.minFame &&
      (!options.region || regionOf(a) === options.region) &&
      (!options.era || eraOf(a) === options.era),
  ).length;
}
