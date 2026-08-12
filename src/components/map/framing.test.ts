import { describe, expect, it } from 'vitest';
import {
  clampPadding,
  MAX_PADDING_SHARE,
  regionSpan,
  REVEAL_MIN_ZOOM,
  shouldFrameRegion,
} from './framing';

/**
 * Framing a reveal.
 *
 * The reveal has to show the guess, the region it was graded against, and the
 * findspot, on screens from 360px up. These are the rules that keep that possible
 * without zooming out to an unreadable world view.
 */

describe('clampPadding', () => {
  it('leaves a modest request alone', () => {
    const request = { top: 20, right: 20, bottom: 20, left: 20 };
    expect(clampPadding(request, 800, 600)).toEqual(request);
  });

  it('shrinks a request that would swallow the map', () => {
    // A phone reveal: 253px tall, asking for 204px of vertical padding.
    const clamped = clampPadding({ top: 64, right: 64, bottom: 140, left: 64 }, 390, 253);
    expect(clamped.top + clamped.bottom).toBeLessThanOrEqual(253 * MAX_PADDING_SHARE + 0.001);
    expect(clamped.left + clamped.right).toBeLessThanOrEqual(390 * MAX_PADDING_SHARE + 0.001);
  });

  it('keeps the asymmetry that holds a marker clear of the action bar', () => {
    const clamped = clampPadding({ top: 64, right: 64, bottom: 140, left: 64 }, 390, 253);
    // Bottom asked for more than top and must still get more.
    expect(clamped.bottom).toBeGreaterThan(clamped.top);
    expect(clamped.bottom / clamped.top).toBeCloseTo(140 / 64, 5);
  });

  it('always leaves usable space in the middle', () => {
    for (const [w, h] of [
      [360, 200],
      [390, 253],
      [844, 390],
      [1440, 900],
    ]) {
      const clamped = clampPadding({ top: 200, right: 200, bottom: 300, left: 200 }, w!, h!);
      expect(clamped.left + clamped.right).toBeLessThan(w!);
      expect(clamped.top + clamped.bottom).toBeLessThan(h!);
    }
  });

  it('survives a zero-sized container without dividing by zero', () => {
    const clamped = clampPadding({ top: 10, right: 10, bottom: 10, left: 10 }, 0, 0);
    for (const value of Object.values(clamped)) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('regionSpan', () => {
  it('converts a radius to a latitude delta', () => {
    expect(regionSpan(0, 111.19).latDelta).toBeCloseTo(1, 3);
  });

  it('widens the longitude delta towards the poles', () => {
    // The same radius covers more degrees of longitude at 60°N than at the equator.
    expect(regionSpan(60, 380).lonDelta).toBeGreaterThan(regionSpan(0, 380).lonDelta);
  });

  it('does not explode at the pole', () => {
    const span = regionSpan(89.9, 380);
    expect(Number.isFinite(span.lonDelta)).toBe(true);
    expect(span.lonDelta).toBeLessThanOrEqual(60);
  });

  it('grows with the radius', () => {
    expect(regionSpan(30, 380).latDelta).toBeGreaterThan(regionSpan(30, 120).latDelta);
  });
});

describe('shouldFrameRegion', () => {
  it('frames the whole region when it fits comfortably', () => {
    expect(shouldFrameRegion(5, 7)).toBe(true);
  });

  it('drops the region rather than zooming out to a smudge', () => {
    // A 380 km radius on a phone would force zoom 1; the markers matter more.
    expect(shouldFrameRegion(1, 6)).toBe(false);
  });

  it('keeps the region when the markers alone are just as wide', () => {
    // A guess on the far side of the world needs a world view either way, so
    // including the region costs nothing.
    expect(shouldFrameRegion(1, 1)).toBe(true);
    expect(shouldFrameRegion(2, 2)).toBe(true);
  });

  it('treats the floor as the boundary', () => {
    expect(shouldFrameRegion(REVEAL_MIN_ZOOM, 8)).toBe(true);
    expect(shouldFrameRegion(REVEAL_MIN_ZOOM - 1, 8)).toBe(false);
  });
});
