import { describe, expect, it } from 'vitest';
import {
  CULTURE_PLACES,
  cultureRejectionReason,
  resolveCulture,
  UNRESOLVABLE_CULTURES,
} from './cultures';
import { countryCompatible } from './gazetteer';
import { buildOrigin, TIER_PROFILE } from './geoTiers';
import { distanceKm } from '../../src/game/geo';

/** Great-circle distance from a resolved culture centre to an expected point. */
function kmFrom(culture: string, lat: number, lon: number): number {
  const hit = resolveCulture(culture);
  if (!hit) throw new Error(`"${culture}" did not resolve`);
  return distanceKm({ lat: hit.lat, lon: hit.lon }, { lat, lon });
}

describe('resolveCulture — the two reported failures', () => {
  it('"Greek, Attic" resolves to Attica, not Attichy in France', () => {
    const hit = resolveCulture('Greek, Attic')!;
    expect(hit.label).toBe('Attica');
    expect(hit.country).toBe('Greece');
    // Attichy, Oise is at 49.41 N, 3.05 E — over 1,800 km from Attica.
    expect(
      distanceKm({ lat: hit.lat, lon: hit.lon }, { lat: 49.4125, lon: 3.047222 }),
    ).toBeGreaterThan(1500);
    // Within 40 km of Athens.
    expect(kmFrom('Greek, Attic', 37.9755, 23.7348)).toBeLessThan(40);
  });

  it('"Moche" resolves to the north coast of Peru, not Denmark', () => {
    const hit = resolveCulture('Moche')!;
    expect(hit.country).toBe('Peru');
    expect(hit.label).toMatch(/north coast/i);
    // Gribskov Municipality, Denmark is at 56.05 N, 12.22 E.
    expect(
      distanceKm({ lat: hit.lat, lon: hit.lon }, { lat: 56.05, lon: 12.216667 }),
    ).toBeGreaterThan(9000);
    // Within 100 km of Trujillo, the Moche heartland.
    expect(kmFrom('Moche', -8.11, -79.03)).toBeLessThan(100);
  });
});

describe('resolveCulture — historically defensible centres', () => {
  it.each([
    ['Greek, Attic', 37.98, 23.73, 60, 'Athens'],
    ['Attic', 37.98, 23.73, 60, 'Athens'],
    ['Minoan', 35.3, 25.16, 120, 'Knossos, Crete'],
    ['Mycenaean', 37.73, 22.76, 60, 'Mycenae'],
    ['Cycladic', 37.05, 25.15, 80, 'the Cyclades'],
    ['Etruscan', 42.6, 11.8, 90, 'Etruria'],
    ['Ancient Rome', 41.89, 12.48, 60, 'Rome'],
    ['Sumerian', 31.32, 45.64, 120, 'Uruk'],
    ['Assyrian', 36.1, 43.33, 120, 'Nimrud'],
    ['Babylonian', 32.54, 44.42, 120, 'Babylon'],
    ['Ancient Egypt', 25.72, 32.66, 220, 'Thebes, Egypt'],
    ['Hittite', 40.02, 34.62, 60, 'Hattusa'],
    ['Achaemenid', 29.94, 52.89, 60, 'Persepolis'],
    ['Moche', -8.11, -79.03, 100, 'Trujillo'],
    ['Chimú', -8.11, -79.07, 100, 'Chan Chan'],
    ['Nasca', -14.7, -75.13, 90, 'the Nasca lines'],
    ['Inca', -13.52, -71.98, 60, 'Cusco'],
    ['Maya', 17.22, -89.62, 200, 'Tikal'],
    ['Aztec', 19.43, -99.13, 60, 'Tenochtitlan'],
    ['Teotihuacan', 19.69, -98.84, 30, 'Teotihuacan'],
    ['Zapotec', 17.04, -96.77, 60, 'Monte Albán'],
    ['Cypriot', 35.05, 33.2, 90, 'Cyprus'],
    ['Phoenician', 33.9, 35.5, 90, 'the Levantine coast'],
    ['Gandharan', 34.17, 72.03, 90, 'the Peshawar valley'],
  ])('%s lands near %s', (culture, lat, lon, maxKm) => {
    expect(kmFrom(culture, lat, lon)).toBeLessThan(maxKm);
  });

  it('prefers the most specific segment of a compound culture string', () => {
    // "Greek, Attic" must give Attica, not the whole Aegean.
    expect(resolveCulture('Greek, Attic')!.label).toBe('Attica');
    expect(resolveCulture('Ancient Greece')!.label).toMatch(/Aegean/);
  });

  it('never resolves a culture more precisely than a subregion', () => {
    // A culture is not a point. Teotihuacan is the documented exception: the
    // culture is defined by that one city.
    for (const [key, place] of Object.entries(CULTURE_PLACES)) {
      if (key === 'teotihuacan') {
        expect(place.tier).toBe('site');
        continue;
      }
      expect(['subregion', 'culture-region'], `${key} is ${place.tier}`).toContain(place.tier);
    }
  });

  it('gives every entry a documented justification and plausible coordinates', () => {
    for (const [key, place] of Object.entries(CULTURE_PLACES)) {
      expect(place.note.length, `${key} has no note`).toBeGreaterThan(15);
      expect(Math.abs(place.lat), `${key} latitude`).toBeLessThanOrEqual(90);
      expect(Math.abs(place.lon), `${key} longitude`).toBeLessThanOrEqual(180);
      // Null Island is always a bug.
      expect(place.lat === 0 && place.lon === 0, `${key} is at (0,0)`).toBe(false);
    }
  });
});

describe('resolveCulture — refuses what it cannot defend', () => {
  it.each([
    'Islamic',
    'Gravettian',
    'South Asian',
    'Southeast Asian',
    'Himalayan',
    'German',
    'French',
    'British',
    'Spanish',
    'Avar',
    'Sasanian or Islamic',
  ])('declines to place "%s"', (culture) => {
    expect(resolveCulture(culture)).toBeNull();
    expect(cultureRejectionReason(culture)).toBeTruthy();
  });

  it('returns null rather than guessing at an unknown culture', () => {
    expect(resolveCulture('Entirely Invented Culture')).toBeNull();
    expect(resolveCulture('')).toBeNull();
    expect(resolveCulture(null)).toBeNull();
  });

  it('documents a reason for every deliberate refusal', () => {
    for (const [key, reason] of Object.entries(UNRESOLVABLE_CULTURES)) {
      expect(reason.length, `${key} has no reason`).toBeGreaterThan(15);
      // A culture cannot be both refused and mapped.
      expect(CULTURE_PLACES[key], `${key} is both mapped and refused`).toBeUndefined();
    }
  });

  it('matches on whole tokens, never substrings', () => {
    // "Attican" and "Atticism" are not "Attic"; a substring matcher would accept them.
    expect(resolveCulture('Atticism')).toBeNull();
    expect(resolveCulture('Romanesque')).toBeNull();
    expect(resolveCulture('Mayan Revival')).toBeNull();
  });
});

describe('countryCompatible', () => {
  it('rejects a Danish coordinate offered for a Peruvian object', () => {
    // The exact failure behind "Gribskov Municipality, North Coast, Peru".
    const result = countryCompatible(56.05, 12.216667, 'Peru');
    expect(result.checked).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.distanceKm).toBeGreaterThan(9000);
  });

  it('rejects a French coordinate offered for a Greek object', () => {
    // Exactly the "Attic → Attichy" geometry, from the other direction.
    expect(countryCompatible(49.4125, 3.047222, 'Greece').ok).toBe(false);
  });

  it('accepts a coordinate inside the named country', () => {
    expect(countryCompatible(37.98, 23.73, 'Greece').ok).toBe(true);
    expect(countryCompatible(-8.11, -79.03, 'Peru').ok).toBe(true);
    expect(countryCompatible(25.72, 32.66, 'Egypt').ok).toBe(true);
  });

  it('allows for continental extent', () => {
    // Vladivostok is 6,400 km from Russia's centroid and still in Russia.
    expect(countryCompatible(43.1, 131.9, 'Russia').ok).toBe(true);
    // Vancouver.
    expect(countryCompatible(49.28, -123.12, 'Canada').ok).toBe(true);
  });

  it('declines to judge countries whose territory spans oceans', () => {
    // Hawaii is further from the contiguous US than Berlin is; no single radius
    // separates far-flung territory from the wrong continent, so the check abstains
    // rather than guessing.
    for (const point of [
      [21.3, -157.8, 'United States'],
      [4.94, -52.33, 'France'],
    ] as const) {
      const result = countryCompatible(point[0], point[1], point[2]);
      expect(result.checked).toBe(false);
      expect(result.ok).toBe(true);
    }
  });

  it('still constrains compact countries tightly', () => {
    // These are the ones that matter for the bugs this guard exists to stop.
    expect(countryCompatible(52.5, 13.4, 'Greece').ok).toBe(false);
    expect(countryCompatible(52.5, 13.4, 'Peru').ok).toBe(false);
    expect(countryCompatible(52.5, 13.4, 'Egypt').ok).toBe(false);
    expect(countryCompatible(52.5, 13.4, 'Iraq').ok).toBe(false);
  });

  it('reports "not checked" when there is no usable hint', () => {
    expect(countryCompatible(0, 0, null).checked).toBe(false);
    expect(countryCompatible(0, 0, '').checked).toBe(false);
    // An unrecognised historical name cannot constrain anything.
    expect(countryCompatible(20, 30, 'Land of Punt').checked).toBe(false);
  });

  it('resolves historical country aliases so they can constrain', () => {
    // "Nubia" is aliased to Sudan, so it *is* usable as a constraint.
    const nubia = countryCompatible(18.5, 31.8, 'Nubia');
    expect(nubia.checked).toBe(true);
    expect(nubia.ok).toBe(true);
    expect(countryCompatible(48.85, 2.35, 'Nubia').ok).toBe(false);
  });
});

describe('confidence handling for culture-derived origins', () => {
  /** Builds an origin the way the providers do for a culture-table match. */
  function originFromCulture(culture: string) {
    const hit = resolveCulture(culture)!;
    return buildOrigin({
      lat: hit.lat,
      lon: hit.lon,
      label: hit.label,
      country: hit.country,
      tier: hit.tier,
      kind: 'cultural-origin',
      resolvedBy: 'culture',
      resolvedId: `culture:${hit.matchedToken}`,
      precision: 'precise',
    });
  }

  it('never reaches the confidence of a recorded findspot', () => {
    const inferred = originFromCulture('Moche');
    const recorded = buildOrigin({
      lat: 25.7381,
      lon: 32.6064,
      label: 'Deir el-Bahri',
      country: 'Egypt',
      tier: 'findspot',
      kind: 'findspot',
      resolvedBy: 'curated',
      precision: 'precise',
    });
    expect(inferred.confidence).toBeLessThan(recorded.confidence);
  });

  it('is not promoted to city-level certainty', () => {
    // The pre-fix bundle stored culture guesses at `city` tier with confidence
    // 0.625 — presenting an inference as though a city had been recorded.
    for (const culture of ['Moche', 'Greek, Attic', 'Assyrian', 'Maya', 'Aztec']) {
      const origin = originFromCulture(culture);
      expect(origin.tier, culture).not.toBe('city');
      expect(origin.tier, culture).not.toBe('findspot');
      expect(origin.confidence, culture).toBeLessThan(TIER_PROFILE.city.confidence);
    }
  });

  it('carries an uncertainty radius wide enough to be honest', () => {
    // A cultural heartland is hundreds of km across; scoring must forgive that.
    const moche = originFromCulture('Moche');
    expect(moche.uncertaintyKm).toBeGreaterThan(300);
    const attica = originFromCulture('Greek, Attic');
    expect(attica.uncertaintyKm).toBeGreaterThan(100);
  });

  it('records the culture table as the resolver, not a gazetteer', () => {
    const origin = originFromCulture('Moche');
    expect(origin.resolvedBy).toBe('culture');
    expect(origin.resolvedId).toBe('culture:moche');
  });

  it('keeps label and coordinate from the same entity', () => {
    // The label must be the culture centre's own label, never spliced with
    // provider context that did not supply the coordinate.
    const hit = resolveCulture('Moche')!;
    const origin = originFromCulture('Moche');
    expect(origin.label).toBe(hit.label);
    expect(origin.lat).toBeCloseTo(hit.lat, 5);
    expect(origin.lon).toBeCloseTo(hit.lon, 5);
  });
});
