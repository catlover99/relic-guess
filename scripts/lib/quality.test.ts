import { describe, expect, it } from 'vitest';
import { fameScore, qualityScore, rejectArtifact } from './quality';
import { buildOrigin, isPlayableTier, TIER_PROFILE } from './geoTiers';
import { makeArtifact } from '../../src/test/factories';

describe('rejectArtifact', () => {
  it('accepts a well-formed record', () => {
    expect(rejectArtifact(makeArtifact())).toBeNull();
  });

  it('rejects a record with no image', () => {
    expect(rejectArtifact(makeArtifact({ image: { url: '' } }))?.id).toBe('no-image');
  });

  it('rejects an insecure image URL', () => {
    // Mixed content would be blocked by the browser anyway.
    expect(rejectArtifact(makeArtifact({ image: { url: 'http://example.test/a.jpg' } }))?.id).toBe(
      'insecure-image',
    );
  });

  it('rejects a country-centroid origin as too coarse', () => {
    const rejection = rejectArtifact(
      makeArtifact({ origin: { tier: 'country', confidence: 0.25, uncertaintyKm: 520 } }),
    );
    expect(rejection?.id).toBe('coordinate-too-coarse');
  });

  it('accepts a cultural-region origin', () => {
    expect(
      rejectArtifact(
        makeArtifact({ origin: { tier: 'culture-region', confidence: 0.42, uncertaintyKm: 380 } }),
      ),
    ).toBeNull();
  });

  it('rejects a low-confidence origin', () => {
    expect(rejectArtifact(makeArtifact({ origin: { confidence: 0.2 } }))?.id).toBe(
      'low-confidence',
    );
  });

  it('rejects modern objects outside the game period', () => {
    expect(rejectArtifact(makeArtifact({ yearStart: 1890, yearEnd: 1910 }))?.id).toBe(
      'out-of-period',
    );
  });

  it('keeps objects inside the period cutoff', () => {
    expect(rejectArtifact(makeArtifact({ yearStart: 1500, yearEnd: 1600 }))).toBeNull();
  });

  it('keeps undated objects rather than discarding them', () => {
    // Plenty of good archaeological records have no date at all.
    expect(rejectArtifact(makeArtifact({ yearStart: null, yearEnd: null }))).toBeNull();
  });

  it.each([
    ['Glass plate negative', 'photograph'],
    ['Plaster cast of a relief', 'cast'],
    ['Electrotype reproduction', 'reproduction'],
  ])('rejects out-of-scope object type: %s', (objectType) => {
    expect(rejectArtifact(makeArtifact({ objectType }))?.id).toBe('out-of-scope-type');
  });

  it('rejects a record with no metadata worth showing', () => {
    const bare = makeArtifact({
      description: null,
      culture: null,
      period: null,
      dateDisplay: null,
      material: null,
      yearStart: null,
      yearEnd: null,
    });
    expect(rejectArtifact(bare)?.id).toBe('no-metadata');
  });

  it('rejects a record with no usable title', () => {
    expect(rejectArtifact(makeArtifact({ title: 'a' }))?.id).toBe('no-title');
  });
});

describe('qualityScore', () => {
  it('stays within 0 and 1', () => {
    expect(qualityScore(makeArtifact())).toBeGreaterThan(0);
    expect(qualityScore(makeArtifact())).toBeLessThanOrEqual(1);
  });

  it('rewards richer metadata', () => {
    const rich = qualityScore(makeArtifact());
    const poor = qualityScore(
      makeArtifact({
        description: null,
        culture: null,
        period: null,
        material: null,
        objectType: null,
        discovery: null,
        dateDisplay: null,
        yearStart: null,
        yearEnd: null,
      }),
    );
    expect(rich).toBeGreaterThan(poor);
  });

  it('rewards a more confident coordinate', () => {
    const precise = qualityScore(makeArtifact({ origin: { confidence: 0.98 } }));
    const vague = qualityScore(makeArtifact({ origin: { confidence: 0.4 } }));
    expect(precise).toBeGreaterThan(vague);
  });
});

describe('fameScore', () => {
  it('stays within 0 and 1', () => {
    expect(
      fameScore({ title: 'X', sitelinks: 500, isHighlight: true, imageCount: 90 }),
    ).toBeLessThanOrEqual(1);
    expect(fameScore({ title: 'fragment' })).toBeGreaterThanOrEqual(0);
  });

  it('rates a curatorial highlight above an ordinary object', () => {
    expect(fameScore({ title: 'Sphinx of Hatshepsut', isHighlight: true })).toBeGreaterThan(
      fameScore({ title: 'Sphinx of Hatshepsut' }),
    );
  });

  it('rates a heavily-linked Wikidata item as famous', () => {
    expect(fameScore({ title: 'Rosetta Stone', sitelinks: 90 })).toBeGreaterThan(0.45);
  });

  it('penalises generic type-label titles', () => {
    expect(fameScore({ title: 'Fragment of a bowl', sitelinks: 2 })).toBeLessThan(
      fameScore({ title: 'Mask of Tutankhamun', sitelinks: 2 }),
    );
  });
});

describe('buildOrigin', () => {
  const base = {
    lat: 25.7,
    lon: 32.6,
    label: 'Thebes',
    country: 'Egypt',
    resolvedBy: 'curated' as const,
  };

  it('derives confidence and uncertainty from the tier', () => {
    const origin = buildOrigin({
      ...base,
      tier: 'findspot',
      kind: 'findspot',
      precision: 'precise',
    });
    expect(origin.uncertaintyKm).toBe(TIER_PROFILE.findspot.uncertaintyKm);
    expect(origin.confidence).toBeCloseTo(TIER_PROFILE.findspot.confidence, 2);
  });

  it('gives a coarser tier a wider uncertainty', () => {
    const site = buildOrigin({ ...base, tier: 'site', kind: 'findspot', precision: 'precise' });
    const region = buildOrigin({
      ...base,
      tier: 'culture-region',
      kind: 'findspot',
      precision: 'precise',
    });
    expect(region.uncertaintyKm).toBeGreaterThan(site.uncertaintyKm);
    expect(region.confidence).toBeLessThan(site.confidence);
  });

  it('penalises a hedged attribution', () => {
    const asserted = buildOrigin({ ...base, tier: 'site', kind: 'findspot', precision: 'precise' });
    const hedged = buildOrigin({ ...base, tier: 'site', kind: 'attributed', precision: 'precise' });
    expect(hedged.confidence).toBeLessThan(asserted.confidence);
    expect(hedged.uncertaintyKm).toBeGreaterThan(asserted.uncertaintyKm);
  });

  it('widens uncertainty for a rough gazetteer location', () => {
    const precise = buildOrigin({ ...base, tier: 'site', kind: 'findspot', precision: 'precise' });
    const rough = buildOrigin({ ...base, tier: 'site', kind: 'findspot', precision: 'rough' });
    expect(rough.uncertaintyKm).toBeGreaterThan(precise.uncertaintyKm);
  });

  it('prefers a measured extent when it is tighter than the tier default', () => {
    // Amarna's Pleiades bbox is about 1.5 km across, far tighter than the
    // site-tier default of 30 km.
    const origin = buildOrigin({
      ...base,
      tier: 'site',
      kind: 'findspot',
      precision: 'precise',
      extentKm: 0.8,
    });
    expect(origin.uncertaintyKm).toBeLessThan(TIER_PROFILE.site.uncertaintyKm);
  });

  it('never lets a measured extent below the hand-placement floor', () => {
    const origin = buildOrigin({
      ...base,
      tier: 'findspot',
      kind: 'findspot',
      precision: 'precise',
      extentKm: 0.01,
    });
    expect(origin.uncertaintyKm).toBeGreaterThanOrEqual(8);
  });

  it('does not let a suspiciously small extent tighten a broad region', () => {
    const origin = buildOrigin({
      ...base,
      tier: 'culture-region',
      kind: 'cultural-origin',
      precision: 'precise',
      extentKm: 400,
    });
    // Capped by the tier default rather than expanded by the extent.
    expect(origin.uncertaintyKm).toBeLessThanOrEqual(
      Math.round(TIER_PROFILE['culture-region'].uncertaintyKm * 1.35),
    );
  });

  it('rounds coordinates to a sane precision', () => {
    const origin = buildOrigin({
      ...base,
      lat: 25.71881234567,
      tier: 'site',
      kind: 'findspot',
    });
    expect(String(origin.lat).split('.')[1]!.length).toBeLessThanOrEqual(6);
  });
});

describe('isPlayableTier', () => {
  it('excludes country centroids', () => {
    expect(isPlayableTier('country')).toBe(false);
  });

  it('includes everything more specific', () => {
    for (const tier of ['findspot', 'site', 'city', 'subregion', 'culture-region'] as const) {
      expect(isPlayableTier(tier)).toBe(true);
    }
  });
});
