import { describe, expect, it } from 'vitest';
import { roundGeography, scoredRegion, separationKm } from './geography';
import { scoreGuess } from './scoring';
import { toleranceFor } from './selection';
import { makeArtifact, makeHeartland } from '@/test/factories';
import type { Artifact } from '@/data/schema';

/**
 * Three geographic concepts, kept separate.
 *
 * The model used to hold one coordinate per artifact, so a reveal could say where
 * an object was dug up *or* describe the region the guess was graded against,
 * never both. These tests exist to stop them collapsing back into one.
 */

/** The Venus de Milo case: found on Milos, 205 km from the Aegean heartland. */
function greekFindspot(overrides: Partial<Artifact> = {}): Artifact {
  return makeArtifact({
    culture: 'Ancient Greek',
    origin: {
      lat: 36.69,
      lon: 24.43,
      label: 'Milos, Greece',
      country: 'Greece',
      tier: 'site',
      kind: 'findspot',
      confidence: 0.92,
      uncertaintyKm: 30,
      resolvedBy: 'pleiades',
      resolvedId: 'pleiades:1',
    },
    heartland: makeHeartland(),
    ...overrides,
  });
}

describe('scoredRegion', () => {
  it('grades Heartland against the cultural homeland', () => {
    const region = scoredRegion(greekFindspot(), 'heartland');
    expect(region.kind).toBe('heartland');
    expect(region.label).toBe('the Aegean Greek world');
    expect(region.culture).toBe('Ancient Greek');
  });

  it('grades the precise modes against the object itself', () => {
    for (const mode of ['scholar', 'expert'] as const) {
      const region = scoredRegion(greekFindspot(), mode);
      expect(region.kind, `${mode} should use the object's own place`).toBe('origin');
      expect(region.label).toBe('Milos, Greece');
    }
  });

  it('falls back to the object when the culture has no homeland', () => {
    const region = scoredRegion(greekFindspot({ heartland: null }), 'heartland');
    expect(region.kind).toBe('origin');
    expect(region.label).toBe('Milos, Greece');
  });

  it('never grades more tightly than the mode promises', () => {
    // A compact homeland must still get the mode's floor.
    const artifact = greekFindspot({ heartland: makeHeartland({ radiusKm: 40 }) });
    expect(scoredRegion(artifact, 'heartland').radiusKm).toBe(toleranceFor('heartland'));
  });

  it('uses the homeland radius when it is wider than the floor', () => {
    const artifact = greekFindspot({ heartland: makeHeartland({ radiusKm: 380 }) });
    expect(scoredRegion(artifact, 'heartland').radiusKm).toBe(380);
  });
});

describe('objectLocation — what qualifies as the discovery pin', () => {
  it('pins a findspot that is away from the scored region', () => {
    const geography = roundGeography(greekFindspot(), 'heartland');
    expect(geography.objectLocation).not.toBeNull();
    expect(geography.objectLocation!.label).toBe('Milos, Greece');
    expect(geography.objectLocation!.role).toBe('found');
  });

  it('says "excavated" only when the record describes a dig', () => {
    const dug = greekFindspot({
      discovery: 'Excavated by the French School at Athens, 1820',
      origin: { ...greekFindspot().origin, tier: 'findspot' },
    });
    expect(roundGeography(dug, 'heartland').objectLocation!.role).toBe('excavated');
  });

  it('says "made at" for a production place rather than calling it a discovery', () => {
    const made = greekFindspot({ origin: { ...greekFindspot().origin, kind: 'creation' } });
    expect(roundGeography(made, 'heartland').objectLocation!.role).toBe('made');
  });

  it('does not pin a culture centre as though the object were found there', () => {
    const cultural = greekFindspot({
      origin: {
        ...greekFindspot().origin,
        kind: 'cultural-origin',
        tier: 'culture-region',
        resolvedBy: 'culture',
      },
    });
    expect(roundGeography(cultural, 'heartland').objectLocation).toBeNull();
  });

  it.each([
    ['country', 'country'],
    ['culture-region', 'culture-region'],
  ] as const)('refuses a %s coordinate as a findspot', (_name, tier) => {
    const coarse = greekFindspot({
      origin: { ...greekFindspot().origin, tier, uncertaintyKm: 520 },
    });
    expect(roundGeography(coarse, 'heartland').objectLocation).toBeNull();
  });

  it('refuses any coordinate that came from the culture table', () => {
    const fromCulture = greekFindspot({
      origin: { ...greekFindspot().origin, resolvedBy: 'culture' },
    });
    expect(roundGeography(fromCulture, 'heartland').objectLocation).toBeNull();
  });

  it('does not add a second marker on top of the scored centre', () => {
    // Origin and homeland are the same place: one marker, not two.
    const together = greekFindspot({
      heartland: makeHeartland({ lat: 36.69, lon: 24.43 }),
    });
    expect(separationKm(together.origin, together.heartland!)).toBeLessThan(5);
    expect(roundGeography(together, 'heartland').objectLocation).toBeNull();
  });

  it('shows no findspot pin in the precise modes, where it is the scored point', () => {
    // Scoring already points at the object's own place; a second identical marker
    // would say there were two different locations.
    expect(roundGeography(greekFindspot(), 'expert').objectLocation).toBeNull();
  });
});

describe('the two concepts are genuinely independent', () => {
  it('keeps a findspot far from its homeland as two separate places', () => {
    // A Greek vase found in Etruria: 1,000+ km from the Aegean, and both are true.
    const exported = greekFindspot({
      origin: {
        ...greekFindspot().origin,
        lat: 42.49,
        lon: 11.63,
        label: 'Vulci, Italy',
        country: 'Italy',
      },
    });
    const geography = roundGeography(exported, 'heartland');

    expect(geography.region.label).toBe('the Aegean Greek world');
    expect(geography.objectLocation!.label).toBe('Vulci, Italy');
    expect(separationKm(geography.region, geography.objectLocation!)).toBeGreaterThan(1000);
  });

  it('scores against the homeland, never the findspot', () => {
    const exported = greekFindspot({
      origin: { ...greekFindspot().origin, lat: 42.49, lon: 11.63, label: 'Vulci, Italy' },
    });
    const geography = roundGeography(exported, 'heartland');

    // A guess on the homeland scores full marks even though the object was found
    // 1,000 km away; a guess at the findspot does not.
    const atHomeland = scoreGuess(
      { lat: geography.region.lat, lon: geography.region.lon },
      { ...geography.region, uncertaintyKm: geography.region.radiusKm },
    );
    const atFindspot = scoreGuess(
      { lat: 42.49, lon: 11.63 },
      { ...geography.region, uncertaintyKm: geography.region.radiusKm },
    );

    expect(atHomeland.score).toBe(5000);
    expect(atFindspot.score).toBeLessThan(atHomeland.score);
  });

  it('the discovery pin cannot change the score', () => {
    const near = greekFindspot();
    const far = greekFindspot({
      origin: { ...greekFindspot().origin, lat: 42.49, lon: 11.63, label: 'Vulci, Italy' },
    });
    const guess = { lat: 38, lon: 24 };

    const scoreOf = (artifact: Artifact) => {
      const region = scoredRegion(artifact, 'heartland');
      return scoreGuess(guess, { ...region, uncertaintyKm: region.radiusKm }).score;
    };

    // Same culture, same homeland, findspots 1,000 km apart — identical score.
    expect(scoreOf(near)).toBe(scoreOf(far));
  });
});

describe('artifacts with a homeland but no findspot', () => {
  const culturalOnly = makeArtifact({
    culture: 'Ancient Greek',
    heartland: makeHeartland(),
    origin: {
      lat: 38.05,
      lon: 23.8,
      label: 'the Aegean Greek world',
      country: 'Greece',
      tier: 'culture-region',
      kind: 'cultural-origin',
      confidence: 0.34,
      uncertaintyKm: 380,
      resolvedBy: 'culture',
      resolvedId: 'culture:greek',
    },
  });

  it('still describes a scored region', () => {
    const geography = roundGeography(culturalOnly, 'heartland');
    expect(geography.regionIsHeartland).toBe(true);
    expect(geography.region.radiusKm).toBeGreaterThan(0);
  });

  it('invents no discovery pin', () => {
    expect(roundGeography(culturalOnly, 'heartland').objectLocation).toBeNull();
  });
});
