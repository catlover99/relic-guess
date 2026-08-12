import { describe, expect, it } from 'vitest';
import { ERAS, eraLabel, eraOf, eraRange, eraWithRange, formatYearRange } from './eras';
import { regionFromPoint, regionLabel, regionOf } from './regions';
import { makeArtifact } from '@/test/factories';

describe('eraOf', () => {
  it.each([
    [-40000, 'prehistoric'],
    [-3001, 'prehistoric'],
    [-3000, 'bronze'],
    [-1300, 'bronze'],
    [-1199, 'classical'],
    [0, 'classical'],
    [300, 'classical'],
    [301, 'late-antique'],
    [999, 'late-antique'],
    [1001, 'medieval'],
    [1600, 'medieval'],
  ])('places year %i in %s', (year, expected) => {
    expect(eraOf({ yearStart: year, yearEnd: year })).toBe(expected);
  });

  it('uses the midpoint of a range', () => {
    // A range straddling a boundary should land where its centre falls.
    expect(eraOf({ yearStart: -1400, yearEnd: -1000 })).toBe('bronze');
  });

  it('falls back to whichever bound exists', () => {
    expect(eraOf({ yearStart: -500, yearEnd: null })).toBe('classical');
    expect(eraOf({ yearStart: null, yearEnd: -500 })).toBe('classical');
  });

  it('returns null for an undated object', () => {
    expect(eraOf({ yearStart: null, yearEnd: null })).toBeNull();
  });

  it('has a label for every era and for null', () => {
    expect(eraLabel('bronze')).toBe('Bronze Age');
    expect(eraLabel(null)).toBe('Undated');
  });
});

describe('formatYearRange', () => {
  it('annotates only the second value when both are BCE', () => {
    expect(formatYearRange(-1473, -1458)).toBe('1473–1458 BCE');
  });

  it('handles a single year', () => {
    expect(formatYearRange(-599, -599)).toBe('599 BCE');
    expect(formatYearRange(700, 700)).toBe('700 CE');
  });

  it('annotates both sides when a range crosses the era boundary', () => {
    expect(formatYearRange(-50, 120)).toBe('50 BCE – 120 CE');
  });

  it('returns null when undated', () => {
    expect(formatYearRange(null, null)).toBeNull();
  });

  it('copes with one bound missing', () => {
    expect(formatYearRange(-300, null)).toBe('300 BCE');
    expect(formatYearRange(null, 450)).toBe('450 CE');
  });
});

describe('regionOf', () => {
  it.each([
    ['Egypt', 'africa'],
    ['Iraq', 'west-asia'],
    ['Greece', 'mediterranean'],
    ['Italy', 'mediterranean'],
    ['United Kingdom', 'europe'],
    ['China', 'east-asia'],
    ['Peru', 'americas'],
    ['Cambodia', 'southeast-asia'],
    ['Pakistan', 'south-asia'],
    ['New Zealand', 'oceania'],
  ])('maps the country %s to %s', (country, expected) => {
    expect(regionOf(makeArtifact({ origin: { country } }))).toBe(expected);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(regionOf(makeArtifact({ origin: { country: '  eGyPt ' } }))).toBe('africa');
  });

  it('resolves historical country names by substring', () => {
    expect(regionOf(makeArtifact({ origin: { country: 'Nubia, ancient' } }))).toBe('africa');
  });

  it('falls back to coordinates when the country is unknown', () => {
    // Pleiades resolutions often carry no country at all.
    expect(regionOf(makeArtifact({ origin: { country: null, lat: 36.1, lon: 43.3 } }))).toBe(
      'west-asia',
    );
  });

  it('classifies the Egyptian Nile corridor as Africa, not the Mediterranean', () => {
    // The box order matters: an unqualified Mediterranean box would swallow Egypt.
    expect(regionFromPoint({ lat: 25.7, lon: 32.6 })).toBe('africa');
  });

  it('handles a box that wraps the antimeridian', () => {
    expect(regionFromPoint({ lat: -20, lon: -170 })).toBe('oceania');
  });

  it('has a label for every region and for null', () => {
    expect(regionLabel('west-asia')).toBe('West Asia');
    expect(regionLabel(null)).toBe('Unknown region');
  });
});

describe('era ranges', () => {
  it('gives every era a chronological span', () => {
    for (const era of ERAS) {
      expect(eraRange(era.id)).toBeTruthy();
      // Every span has to say which side of the epoch it is on.
      expect(eraRange(era.id)).toMatch(/BCE|CE/);
    }
  });

  it('names the era and dates it together', () => {
    expect(eraWithRange('classical')).toBe('Classical Antiquity · c. 1200 BCE – 300 CE');
    expect(eraWithRange('bronze')).toBe('Bronze Age · c. 3000–1200 BCE');
    expect(eraWithRange('prehistoric')).toBe('Prehistory · before c. 3000 BCE');
  });

  it('uses BCE/CE everywhere, never BC/AD', () => {
    for (const era of ERAS) {
      expect(era.range).not.toMatch(/\b(BC|AD)\b/);
    }
  });

  it('marks the spans as approximate', () => {
    // These boundaries are conventional round numbers, and the artifact's own
    // recorded date is always the precise statement.
    for (const era of ERAS) {
      expect(era.range).toContain('c. ');
    }
  });

  it('has no gaps or overlaps between consecutive eras', () => {
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERAS[i]!.max).toBeGreaterThan(ERAS[i - 1]!.max);
    }
  });

  it('describes an undated object rather than inventing a range', () => {
    expect(eraWithRange(null)).toBe('Undated');
    expect(eraRange(null)).toBeNull();
  });

  it('avoids the awkward provider-style label players complained about', () => {
    const labels = ERAS.map((era) => era.label);
    expect(labels).not.toContain('Medieval & After');
    expect(labels).toContain('Medieval & Later');
  });
});
