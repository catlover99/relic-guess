import { describe, expect, it } from 'vitest';
import { isValidArtifact, parseBundle } from './schema';
import { makeArtifact } from '@/test/factories';

describe('isValidArtifact', () => {
  it('accepts a well-formed artifact', () => {
    expect(isValidArtifact(makeArtifact())).toBe(true);
  });

  it.each([null, undefined, 42, 'artifact', []])('rejects the non-object %p', (value) => {
    expect(isValidArtifact(value)).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(isValidArtifact({ ...makeArtifact(), provider: 'louvre' })).toBe(false);
  });

  it('rejects a missing title', () => {
    expect(isValidArtifact({ ...makeArtifact(), title: '   ' })).toBe(false);
  });

  it('rejects a missing image url', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, image: { ...artifact.image, url: '' } })).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lat: 91 } })).toBe(false);
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lon: -181 } })).toBe(false);
  });

  it('rejects the null-island coordinate', () => {
    // Every provider that fails to resolve a place ends up at (0, 0), so it is
    // always a bug rather than a real origin.
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lat: 0, lon: 0 } })).toBe(
      false,
    );
  });

  it('accepts a genuine coordinate on the equator or prime meridian', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lat: 0, lon: 32 } })).toBe(
      true,
    );
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lat: 51, lon: 0 } })).toBe(
      true,
    );
  });

  it('rejects NaN coordinates', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, lat: Number.NaN } })).toBe(
      false,
    );
  });

  it('rejects an unknown coordinate tier or origin kind', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, tier: 'galaxy' } })).toBe(
      false,
    );
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, kind: 'vibes' } })).toBe(
      false,
    );
  });

  it('rejects an out-of-range confidence', () => {
    const artifact = makeArtifact();
    expect(isValidArtifact({ ...artifact, origin: { ...artifact.origin, confidence: 1.4 } })).toBe(
      false,
    );
  });

  it('rejects a negative uncertainty', () => {
    const artifact = makeArtifact();
    expect(
      isValidArtifact({ ...artifact, origin: { ...artifact.origin, uncertaintyKm: -5 } }),
    ).toBe(false);
  });
});

describe('parseBundle', () => {
  it('reads the artifacts array from a bundle', () => {
    const result = parseBundle({
      version: 1,
      generatedAt: 'x',
      sources: [],
      artifacts: [makeArtifact()],
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('accepts a bare array for backwards compatibility', () => {
    expect(parseBundle([makeArtifact()]).artifacts).toHaveLength(1);
  });

  it('drops invalid records instead of throwing', () => {
    const artifact = makeArtifact();
    const result = parseBundle({
      version: 1,
      generatedAt: 'x',
      sources: [],
      artifacts: [artifact, { ...artifact, id: 'bad', title: '' }, null, { nope: true }],
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.dropped).toBe(3);
  });

  it('returns empty for malformed input rather than crashing', () => {
    expect(parseBundle(null).artifacts).toEqual([]);
    expect(parseBundle('nonsense').artifacts).toEqual([]);
    expect(parseBundle({}).artifacts).toEqual([]);
  });
});
