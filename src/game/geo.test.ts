import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  compassDirection,
  distanceKm,
  formatDistance,
  greatCircleSegments,
  midpoint,
} from './geo';

describe('distanceKm', () => {
  it('is zero for identical points', () => {
    expect(distanceKm({ lat: 30, lon: 31 }, { lat: 30, lon: 31 })).toBe(0);
  });

  it('matches a known great-circle distance', () => {
    // Giza to Athens is ~1,120 km by great circle.
    const d = distanceKm({ lat: 29.9773, lon: 31.1325 }, { lat: 37.9755, lon: 23.7348 });
    expect(d).toBeGreaterThan(1090);
    expect(d).toBeLessThan(1150);
  });

  it('measures one degree of latitude as ~111 km', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
  });

  it('is symmetric', () => {
    const a = { lat: -33.9, lon: 18.4 };
    const b = { lat: 51.5, lon: -0.1 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 6);
  });

  it('takes the short way across the antimeridian', () => {
    // 179°E to 179°W is 2 degrees apart, not 358.
    const d = distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 });
    expect(d).toBeLessThan(250);
  });

  it('stays accurate for sub-kilometre distances', () => {
    // 0.001° of latitude is ~111 m; the law-of-cosines form loses precision here.
    const d = distanceKm({ lat: 40, lon: 20 }, { lat: 40.001, lon: 20 });
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.12);
  });

  it('handles antipodes without exceeding half the circumference', () => {
    const d = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(d).toBeCloseTo(20015.1, 0);
  });
});

describe('bearingDeg and compassDirection', () => {
  it('reports due north', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 4);
    expect(compassDirection({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBe('N');
  });

  it('reports due east', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 4);
    expect(compassDirection({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBe('E');
  });

  it('reports due west', () => {
    expect(compassDirection({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBe('W');
  });

  it('reports south-east', () => {
    expect(compassDirection({ lat: 10, lon: 0 }, { lat: 0, lon: 10 })).toBe('SE');
  });
});

describe('greatCircleSegments', () => {
  it('returns a single segment for a short path', () => {
    const segments = greatCircleSegments({ lat: 30, lon: 30 }, { lat: 35, lon: 35 });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.length).toBeGreaterThan(50);
  });

  it('starts at the origin and ends at the destination', () => {
    const a = { lat: 30, lon: 30 };
    const b = { lat: 35, lon: 35 };
    const points = greatCircleSegments(a, b)[0]!;
    expect(points[0]!.lat).toBeCloseTo(a.lat, 5);
    expect(points[points.length - 1]!.lat).toBeCloseTo(b.lat, 5);
  });

  it('splits a path that crosses the antimeridian', () => {
    // Tokyo to Los Angeles. Rendered as one array this streaks back across the
    // whole map in Leaflet's projected space.
    const segments = greatCircleSegments({ lat: 35.7, lon: 139.7 }, { lat: 34.05, lon: -118.24 });
    expect(segments.length).toBe(2);
    for (const segment of segments) {
      for (let i = 1; i < segment.length; i++) {
        expect(Math.abs(segment[i]!.lon - segment[i - 1]!.lon)).toBeLessThan(180);
      }
    }
  });

  it('degrades gracefully for identical points', () => {
    const segments = greatCircleSegments({ lat: 5, lon: 5 }, { lat: 5, lon: 5 });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.length).toBe(2);
  });
});

describe('midpoint', () => {
  it('lands halfway along a meridian', () => {
    const mid = midpoint({ lat: 0, lon: 0 }, { lat: 20, lon: 0 });
    expect(mid.lat).toBeCloseTo(10, 1);
    expect(mid.lon).toBeCloseTo(0, 1);
  });
});

describe('formatDistance', () => {
  it('uses metres below one kilometre', () => {
    expect(formatDistance(0.42, 'en-US')).toBe('420 m');
  });

  it('keeps one decimal between 1 and 10 km', () => {
    expect(formatDistance(4.26, 'en-US')).toBe('4.3 km');
  });

  it('rounds and groups above 10 km', () => {
    expect(formatDistance(1240.7, 'en-US')).toBe('1,241 km');
  });

  it('handles zero', () => {
    expect(formatDistance(0, 'en-US')).toBe('0 m');
  });
});
