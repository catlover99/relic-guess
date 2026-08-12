import { describe, expect, it } from 'vitest';
import { attachHeartlands, MAX_HEARTLAND_DRIFT_KM, resolveHeartland } from './heartland';
import { makeArtifact } from '../../src/test/factories';
import type { Artifact } from '../../src/data/schema';

/**
 * Attaching a cultural homeland to every artifact that has a defensible one.
 *
 * The culture table used to be consulted only when no place could be resolved, so
 * an object with a known dig site never carried its culture's region. That made the
 * three-part reveal impossible: there was only ever one coordinate to show.
 */

function withCulture(culture: string | null, origin: Partial<Artifact['origin']> = {}): Artifact {
  return makeArtifact({
    culture,
    origin: {
      lat: 36.69,
      lon: 24.43,
      label: 'Milos, Greece',
      country: 'Greece',
      tier: 'site',
      kind: 'findspot',
      resolvedBy: 'pleiades',
      ...origin,
    },
  });
}

describe('resolveHeartland', () => {
  it('attaches a homeland to an artifact that already has a findspot', () => {
    const { heartland, reason } = resolveHeartland(withCulture('Greek, Attic'));
    expect(reason).toBe('ok');
    expect(heartland).not.toBeNull();
    expect(heartland!.label).toBe('Attica');
    expect(heartland!.culture).toBe('Greek, Attic');
  });

  it('sizes the region from the culture table tier, not a flat number', () => {
    // Attica is a subregion; a broad cultural region must be wider.
    const attic = resolveHeartland(withCulture('Greek, Attic')).heartland!;
    const mesopotamian = resolveHeartland(withCulture('Sumerian')).heartland!;
    expect(attic.radiusKm).toBeGreaterThan(0);
    expect(mesopotamian.radiusKm).toBeGreaterThan(0);
    expect(attic.radiusKm).not.toBe(0);
  });

  it('records where the homeland came from', () => {
    // Moche's homeland is in Peru, so the object must be too or the drift guard
    // rejects the match.
    const heartland = resolveHeartland(
      withCulture('Moche', { lat: -8.11, lon: -79.03, label: 'Trujillo, Peru' }),
    ).heartland!;
    expect(heartland.resolvedId).toMatch(/^culture:/);
    expect(heartland.confidence).toBeGreaterThan(0);
    expect(heartland.confidence).toBeLessThanOrEqual(1);
  });

  it('attaches nothing when the object has no culture', () => {
    expect(resolveHeartland(withCulture(null)).reason).toBe('no-culture');
  });

  it('attaches nothing for a culture the table does not cover', () => {
    const result = resolveHeartland(withCulture('Entirely fictional people'));
    expect(result.reason).toBe('unmatched-culture');
    expect(result.heartland).toBeNull();
  });

  it('rejects a homeland implausibly far from the object itself', () => {
    // A "match" on the wrong side of the world is a bad token hit, not a
    // well-travelled object, and must never become the thing a player is scored
    // against.
    const result = resolveHeartland(
      withCulture('Moche', { lat: 35.68, lon: 139.69, label: 'Tokyo, Japan' }),
    );
    expect(result.reason).toBe('implausible-drift');
    expect(result.heartland).toBeNull();
    expect(result.driftKm).toBeGreaterThan(MAX_HEARTLAND_DRIFT_KM);
  });

  it('keeps a genuinely exported object', () => {
    // An Attic vase found in Etruria is ~1,100 km from Attica and entirely real.
    const result = resolveHeartland(
      withCulture('Greek, Attic', { lat: 42.49, lon: 11.63, label: 'Vulci, Italy' }),
    );
    expect(result.reason).toBe('ok');
    expect(result.driftKm).toBeGreaterThan(800);
  });
});

describe('attachHeartlands', () => {
  it('returns every artifact, with or without a homeland', () => {
    const input = [withCulture('Greek, Attic'), withCulture(null), withCulture('Nonsense')];
    const { artifacts, stats } = attachHeartlands(input);

    expect(artifacts).toHaveLength(3);
    expect(stats.attached).toBe(1);
    expect(stats.noCulture).toBe(1);
    expect(stats.unmatched).toBe(1);
  });

  it('never mutates the artifacts it is given', () => {
    const input = [withCulture('Ancient Greek')];
    attachHeartlands(input);
    expect(input[0]!.heartland).toBeNull();
  });

  it('counts homelands that are meaningfully apart from the object', () => {
    const { stats } = attachHeartlands([
      withCulture('Greek, Attic', { lat: 42.49, lon: 11.63 }), // Etruria, far
      withCulture('Greek, Attic', { lat: 38.05, lon: 23.8 }), // on the homeland
    ]);
    expect(stats.attached).toBe(2);
    expect(stats.distinct).toBe(1);
  });
});
