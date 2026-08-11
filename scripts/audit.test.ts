import { describe, expect, it } from 'vitest';
import { CHECKS, runAudit } from './audit';
import { makeArtifact } from '../src/test/factories';

/**
 * The audit checks are themselves tested, because each one encodes a bug this
 * project actually shipped. A check that quietly stops detecting its own bug is
 * worse than no check: it reports "PASS" over a broken dataset.
 *
 * Every case below is a real record from the pre-fix bundle.
 */
function findings(id: string, artifacts: Parameters<typeof runAudit>[0]) {
  return runAudit(artifacts).get(id) ?? [];
}

describe('audit — catches the reported failures', () => {
  it('flags "Attic" resolved to Attichy, France', () => {
    // The real record: met:247363, culture "Greek, Attic", resolved to a French commune.
    const bad = makeArtifact({
      id: 'met:247363',
      culture: 'Greek, Attic',
      origin: {
        lat: 49.4125,
        lon: 3.047222,
        label: 'Attichy',
        country: null,
        tier: 'city',
        kind: 'cultural-origin',
        confidence: 0.625,
        resolvedBy: 'wikidata',
        resolvedId: 'Q696480',
      },
    });

    // Caught two independent ways, so no single check regressing hides it.
    expect(findings('culture-derived-precision', [bad])).toHaveLength(1);
    expect(findings('culture-via-place-search', [bad])).toHaveLength(1);
  });

  it('flags "North Coast" resolved to a Danish municipality for a Peruvian object', () => {
    // The real record: met:312632, culture "Moche".
    const bad = makeArtifact({
      id: 'met:312632',
      culture: 'Moche',
      origin: {
        lat: 56.05,
        lon: 12.216667,
        label: 'Gribskov Municipality, North Coast, Peru',
        country: 'Peru',
        tier: 'city',
        kind: 'cultural-origin',
        confidence: 0.625,
        resolvedBy: 'wikidata',
        resolvedId: 'Q494827',
      },
    });

    expect(findings('country-coordinate-mismatch', [bad])).toHaveLength(1);
    expect(findings('culture-derived-precision', [bad])).toHaveLength(1);
    expect(findings('culture-via-place-search', [bad])).toHaveLength(1);
  });

  it('flags a label naming two unrelated countries', () => {
    // Real pre-fix labels: "Cyprus, United Kingdom", "Malta, Russia", "Babylonia, Iran".
    for (const label of ['Cyprus, United Kingdom', 'Malta, Russia', 'Babylonia, Iran']) {
      const bad = makeArtifact({ origin: { label } });
      expect(findings('multi-country-label', [bad]), label).toHaveLength(1);
    }
  });

  it('flags Null Island coordinates', () => {
    const bad = makeArtifact({ origin: { lat: 0, lon: 0 } });
    expect(findings('null-island', [bad])).toHaveLength(1);
  });

  it('flags a culture inference presented as an exact findspot', () => {
    const bad = makeArtifact({
      culture: 'Moche',
      origin: {
        kind: 'cultural-origin',
        tier: 'findspot',
        lat: -8.16,
        lon: -79.0,
        country: 'Peru',
      },
    });
    expect(findings('culture-derived-precision', [bad])).toHaveLength(1);
  });

  it('flags a culture-table origin whose coordinate has drifted from the table', () => {
    // Guards against the table and the bundle silently diverging — e.g. a coordinate
    // edited in one place but not the other.
    const drifted = makeArtifact({
      culture: 'Moche',
      origin: {
        lat: 40.0,
        lon: 20.0,
        label: 'the Moche north coast of Peru',
        tier: 'culture-region',
        kind: 'cultural-origin',
        resolvedBy: 'culture',
        resolvedId: 'culture:moche',
      },
    });
    expect(findings('culture-coordinate-drift', [drifted])).toHaveLength(1);
  });

  it('flags a label that does not contain the matched record', () => {
    const bad = makeArtifact({
      origin: {
        label: 'Somewhere Else Entirely',
        provenance: {
          source: 'met.geography',
          rawText: 'North Coast',
          query: 'north coast',
          matchType: 'wikidata-exact',
          matchedLabel: 'Gribskov Municipality',
          matchedId: 'Q494827',
          semanticType: 'municipality of Denmark',
          countryChecked: 'Peru',
          countryDistanceKm: 10_000,
          reason: null,
        },
      },
    });
    expect(findings('label-coordinate-provenance', [bad])).toHaveLength(1);
  });
});

describe('audit — accepts correct records', () => {
  const good = [
    // A recorded findspot.
    makeArtifact({
      id: 'met:544442',
      culture: 'Ancient Egypt',
      origin: {
        lat: 25.7381,
        lon: 32.6064,
        label: 'Deir el-Bahri, Upper Egypt, Egypt',
        country: 'Egypt',
        tier: 'findspot',
        kind: 'findspot',
        resolvedBy: 'curated',
        provenance: {
          source: 'met.geography',
          rawText: 'Deir el-Bahri',
          query: 'deir el-bahri',
          matchType: 'curated-exact',
          matchedLabel: 'Deir el-Bahri',
          matchedId: 'curated:deir el-bahri',
          semanticType: 'findspot',
          countryChecked: 'Egypt',
          countryDistanceKm: 210,
          reason: 'Met geography field',
        },
      },
    }),
    // A culture inference, correctly modelled as a region.
    makeArtifact({
      id: 'met:312632',
      culture: 'Moche',
      origin: {
        lat: -8.16,
        lon: -79.0,
        label: 'the Moche north coast of Peru',
        country: 'Peru',
        tier: 'culture-region',
        kind: 'cultural-origin',
        confidence: 0.336,
        uncertaintyKm: 513,
        resolvedBy: 'culture',
        resolvedId: 'culture:moche',
        provenance: {
          source: 'met.culture',
          rawText: 'Moche',
          query: 'moche',
          matchType: 'culture-table',
          matchedLabel: 'the Moche north coast of Peru',
          matchedId: 'culture:moche',
          semanticType: 'culture-region',
          countryChecked: 'Peru',
          countryDistanceKm: 420,
          reason: 'Moche culture of the north-coast river valleys',
        },
      },
    }),
    // Attic, correctly modelled.
    makeArtifact({
      id: 'met:247363',
      culture: 'Greek, Attic',
      origin: {
        lat: 38.05,
        lon: 23.8,
        label: 'Attica',
        country: 'Greece',
        tier: 'subregion',
        kind: 'cultural-origin',
        resolvedBy: 'culture',
        resolvedId: 'culture:attic',
        provenance: {
          source: 'met.culture',
          rawText: 'Greek, Attic',
          query: 'attic',
          matchType: 'culture-table',
          matchedLabel: 'Attica',
          matchedId: 'culture:attic',
          semanticType: 'subregion',
          countryChecked: null,
          countryDistanceKm: null,
          reason: 'Attic pottery was produced in Athens and its Attic hinterland',
        },
      },
    }),
  ];

  it.each(CHECKS.filter((check) => check.blocking).map((check) => check.id))(
    'blocking check "%s" reports nothing',
    (id) => {
      const result = findings(id, good);
      expect(result, result.map((f) => f.detail).join('\n')).toEqual([]);
    },
  );

  it('does not flag an object found far from its culture heartland', () => {
    // A Greek vase in a Scythian burial is legitimate, not a resolver error, as long
    // as the origin is a recorded findspot rather than a culture inference.
    const scythianFind = makeArtifact({
      culture: 'Greek, Attic',
      origin: {
        lat: 47.2,
        lon: 34.5,
        label: 'Solokha kurgan, Ukraine',
        country: 'Ukraine',
        tier: 'findspot',
        kind: 'findspot',
        resolvedBy: 'pleiades',
      },
    });
    expect(findings('culture-coordinate-drift', [scythianFind])).toEqual([]);
    expect(findings('region-mismatch', [scythianFind])).toEqual([]);
  });

  it('every blocking check has a description and an id', () => {
    for (const check of CHECKS) {
      expect(check.id).toMatch(/^[a-z-]+$/);
      expect(check.description.length).toBeGreaterThan(10);
    }
  });
});
