/**
 * Data-quality audit of the generated artifact bundle.
 *
 *   npm run audit
 *   npm run audit -- --verbose      # list every offending record
 *
 * Exits non-zero if any *blocking* check fails, so it can gate a release. The
 * checks encode the failure modes actually observed in this project rather than
 * generic hygiene:
 *
 *   - "Attic" resolving to Attichy, France (culture matched as a place name)
 *   - "North Coast" resolving to a Danish municipality for a Peruvian object
 *   - "Cyprus, United Kingdom" (label and country from different entities)
 *   - 285 records at (0, 0) from blank Pleiades coordinate columns
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, ArtifactBundle } from '../src/data/schema.js';
import { distanceKm } from '../src/game/geo.js';
import { regionOf } from '../src/game/regions.js';
import { COUNTRY_ALIASES, COUNTRY_CENTROIDS } from './lib/places.curated.js';
import { countryCompatible, normalizePlaceKey } from './lib/gazetteer.js';
import { resolveCulture } from './lib/cultures.js';

const BUNDLE = path.resolve(process.cwd(), 'public/data/artifacts.json');

export interface Finding {
  id: string;
  detail: string;
}

export interface Check {
  id: string;
  description: string;
  /** A blocking check must be empty for the audit to pass. */
  blocking: boolean;
  run: (artifacts: Artifact[]) => Finding[];
}

/**
 * Whether a record's coordinate contradicts the country it claims.
 *
 * Delegates to the resolver's own `countryCompatible`, deliberately: an audit that
 * applies a different rule from the pipeline reports failures the pipeline was right
 * to allow. A flat 2,000 km threshold flagged 25 genuine Russian sites, because
 * Russia's centroid is in Siberia and European Russia is 4,000 km from it.
 */
function countryContradiction(artifact: Artifact): string | null {
  const country = artifact.origin.country;
  if (!country) return null;
  const result = countryCompatible(artifact.origin.lat, artifact.origin.lon, country);
  if (!result.checked || result.ok) return null;
  return `${Math.round(result.distanceKm ?? 0)} km from ${country}`;
}

export const CHECKS: Check[] = [
  {
    id: 'null-island',
    description: 'coordinates at (0, 0)',
    blocking: true,
    run: (artifacts) =>
      artifacts
        .filter((a) => a.origin.lat === 0 && a.origin.lon === 0)
        .map((a) => ({ id: a.id, detail: `${a.title} — resolved by ${a.origin.resolvedBy}` })),
  },
  {
    id: 'out-of-range',
    description: 'coordinates outside valid latitude/longitude',
    blocking: true,
    run: (artifacts) =>
      artifacts
        .filter(
          (a) =>
            Math.abs(a.origin.lat) > 90 ||
            Math.abs(a.origin.lon) > 180 ||
            !Number.isFinite(a.origin.lat) ||
            !Number.isFinite(a.origin.lon),
        )
        .map((a) => ({ id: a.id, detail: `${a.origin.lat}, ${a.origin.lon}` })),
  },
  {
    id: 'country-coordinate-mismatch',
    description: 'stated country and coordinate are geographically incompatible',
    blocking: true,
    run: (artifacts) =>
      artifacts
        .map((a) => ({ a, problem: countryContradiction(a) }))
        .filter((entry): entry is { a: Artifact; problem: string } => entry.problem !== null)
        .map(({ a, problem }) => ({
          id: a.id,
          detail: `${problem} — "${a.origin.label}" (${a.origin.resolvedBy})`,
        })),
  },
  {
    id: 'culture-coordinate-drift',
    description: "a culture-table origin whose coordinate is not the table's coordinate",
    blocking: true,
    run: (artifacts) =>
      artifacts.flatMap((a) => {
        /*
         * For a culture-derived origin the coordinate *is* the table's coordinate by
         * construction, so the only meaningful invariant is that they still agree.
         *
         * An earlier version of this check compared the coordinate to the centroid of
         * the culture's country, which produced pure false positives: the Olmec Gulf
         * coast sits 1,035 km from Mexico's centroid because Mexico is elongated, not
         * because anything is wrong.
         */
        if (a.origin.resolvedBy !== 'culture') return [];
        const culture = resolveCulture(a.culture);
        if (!culture) {
          return [
            { id: a.id, detail: `resolved by culture table but "${a.culture}" no longer resolves` },
          ];
        }
        const drift = distanceKm(a.origin, { lat: culture.lat, lon: culture.lon });
        if (drift < 1) return [];
        return [
          {
            id: a.id,
            detail: `culture "${a.culture}" table centre is ${Math.round(drift)} km from the stored coordinate`,
          },
        ];
      }),
  },
  {
    id: 'culture-derived-precision',
    description: 'a culture inference presented as finer than a region',
    blocking: true,
    run: (artifacts) =>
      artifacts
        .filter(
          (a) =>
            a.origin.kind === 'cultural-origin' &&
            (a.origin.tier === 'city' || a.origin.tier === 'findspot'),
        )
        .map((a) => ({
          id: a.id,
          detail: `culture "${a.culture}" resolved to ${a.origin.tier} "${a.origin.label}"`,
        })),
  },
  {
    id: 'culture-via-place-search',
    description: 'a cultural origin resolved through a free-text place search',
    blocking: true,
    run: (artifacts) =>
      artifacts
        .filter((a) => a.origin.kind === 'cultural-origin' && a.origin.resolvedBy === 'wikidata')
        .map((a) => ({
          id: a.id,
          detail: `culture "${a.culture}" → "${a.origin.label}" (${a.origin.resolvedId})`,
        })),
  },
  {
    id: 'multi-country-label',
    description: 'a label naming two different countries',
    blocking: true,
    run: (artifacts) => {
      const countryKeys = new Set(Object.keys(COUNTRY_CENTROIDS));
      return artifacts.flatMap((a) => {
        const named = a.origin.label
          .split(',')
          .map((part) => normalizePlaceKey(part))
          .map((part) => COUNTRY_ALIASES[part] ?? part)
          .filter((part) => countryKeys.has(part));
        const distinct = new Set(named);
        if (distinct.size < 2) return [];
        return [{ id: a.id, detail: `"${a.origin.label}" names ${[...distinct].join(' and ')}` }];
      });
    },
  },
  {
    id: 'label-coordinate-provenance',
    description: 'label not traceable to the record that supplied the coordinate',
    blocking: false,
    run: (artifacts) =>
      artifacts
        .filter((a) => {
          const provenance = a.origin.provenance;
          if (!provenance) return false;
          /*
           * The matched record's own name must appear in the displayed label. Pleiades
           * titles carry slash-separated variants ("Comana/Hierapolis/Chryse") which
           * `tidyPlaceName` renders as "Comana (Hierapolis, Chryse)", and long alias
           * lists get truncated to three segments, so compare on the first name only.
           */
          const matched = provenance.matchedLabel.split(/[/,]/)[0]!.trim().toLowerCase();
          return !a.origin.label.toLowerCase().includes(matched);
        })
        .map((a) => ({
          id: a.id,
          detail: `label "${a.origin.label}" does not contain matched "${a.origin.provenance!.matchedLabel}"`,
        })),
  },
  {
    id: 'missing-provenance',
    description: 'no provenance recorded (cannot be diagnosed later)',
    blocking: false,
    run: (artifacts) =>
      artifacts
        .filter((a) => !a.origin.provenance)
        .map((a) => ({ id: a.id, detail: a.origin.label })),
  },
  {
    id: 'region-mismatch',
    description: 'culture implies one macro-region, coordinate falls in another',
    blocking: false,
    run: (artifacts) =>
      artifacts.flatMap((a) => {
        // Same scoping as culture-country-conflict: a recorded place outranks the
        // culture, and creation places legitimately differ from a heartland.
        if (a.origin.kind === 'findspot' || a.origin.kind === 'creation') return [];
        const culture = resolveCulture(a.culture);
        if (!culture) return [];
        const cultureRegion = regionOf({
          origin: { ...a.origin, lat: culture.lat, lon: culture.lon, country: culture.country },
        });
        const actual = regionOf(a);
        if (!cultureRegion || !actual || cultureRegion === actual) return [];
        return [
          {
            id: a.id,
            detail: `culture "${a.culture}" → ${cultureRegion}, coordinate → ${actual} ("${a.origin.label}")`,
          },
        ];
      }),
  },
];

async function main(): Promise<void> {
  const verbose = process.argv.includes('--verbose');
  const raw = JSON.parse(await readFile(BUNDLE, 'utf8')) as ArtifactBundle;
  const artifacts = raw.artifacts;

  console.log(`Auditing ${artifacts.length} artifacts from ${BUNDLE}\n`);

  let blockingFailures = 0;
  for (const check of CHECKS) {
    const findings = check.run(artifacts);
    const label = findings.length === 0 ? 'PASS' : check.blocking ? 'FAIL' : 'WARN';
    if (findings.length > 0 && check.blocking) blockingFailures += findings.length;

    console.log(
      `${label}  ${check.id.padEnd(30)} ${String(findings.length).padStart(5)}  ${check.description}`,
    );
    const shown = verbose ? findings : findings.slice(0, 3);
    for (const finding of shown) console.log(`        ${finding.id}: ${finding.detail}`);
    if (!verbose && findings.length > shown.length) {
      console.log(`        … ${findings.length - shown.length} more (use --verbose)`);
    }
  }

  /* ---- Distribution summary ------------------------------------- */
  const tally = (key: (a: Artifact) => string) => {
    const counts = new Map<string, number>();
    for (const a of artifacts) counts.set(key(a), (counts.get(key(a)) ?? 0) + 1);
    return [...counts].sort((x, y) => y[1] - x[1]);
  };

  console.log('\nBy resolver:');
  for (const [k, v] of tally((a) => a.origin.resolvedBy))
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log('\nBy match type:');
  for (const [k, v] of tally((a) => a.origin.provenance?.matchType ?? 'none'))
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log('\nBy origin kind:');
  for (const [k, v] of tally((a) => a.origin.kind)) console.log(`  ${String(v).padStart(5)}  ${k}`);

  console.log(
    blockingFailures === 0
      ? '\nAudit passed: no blocking issues.'
      : `\nAudit FAILED: ${blockingFailures} blocking issue(s).`,
  );
  process.exit(blockingFailures === 0 ? 0 : 1);
}

/**
 * Runs every check and returns the findings by check id.
 *
 * Exported so the checks themselves are testable: each one encodes a real bug this
 * project shipped, and a check that silently stops detecting its bug is worse than
 * no check at all.
 */
export function runAudit(artifacts: Artifact[]): Map<string, Finding[]> {
  return new Map(CHECKS.map((check) => [check.id, check.run(artifacts)]));
}

// Only run as a CLI, never on import.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith(path.join('scripts', 'audit.ts'));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
