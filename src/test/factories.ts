import type { Artifact, ArtifactImage, OriginPlace, ProviderId } from '@/data/schema';

/** Nested fields are merged, so a test can override just `origin.lat`. */
export type ArtifactOverrides = Omit<Partial<Artifact>, 'origin' | 'image'> & {
  origin?: Partial<OriginPlace>;
  image?: Partial<ArtifactImage>;
};

/**
 * Builds a valid artifact with overridable fields.
 *
 * Tests should state only what they care about; everything else needs to be
 * plausible enough to pass `isValidArtifact` and the quality gate.
 */
export function makeArtifact(overrides: ArtifactOverrides = {}): Artifact {
  const origin: OriginPlace = {
    lat: 25.7188,
    lon: 32.6573,
    label: 'Thebes, Egypt',
    country: 'Egypt',
    tier: 'site',
    kind: 'findspot',
    confidence: 0.92,
    uncertaintyKm: 30,
    resolvedBy: 'curated' as const,
    resolvedId: 'curated:thebes',
    ...overrides.origin,
  };

  const image: ArtifactImage = {
    url: 'https://images.metmuseum.org/x/web-large/a.jpg',
    alternates: [],
    verifiedAt: null,
    thumbUrl: 'https://images.metmuseum.org/x/mobile-large/a.jpg',
    width: 1200,
    height: 900,
    license: 'CC0 1.0',
    attribution: 'The Metropolitan Museum of Art',
    ...overrides.image,
  };

  return {
    id: 'met:1',
    provider: 'met' as ProviderId,
    providerObjectId: '1',
    title: 'Sphinx of Hatshepsut',
    description: 'A granite sphinx from Deir el-Bahri.',
    culture: 'Ancient Egyptian',
    period: 'New Kingdom',
    yearStart: -1473,
    yearEnd: -1458,
    dateDisplay: 'ca. 1473–1458 BCE',
    material: 'Granite',
    objectType: 'Sculpture',
    discovery: 'MMA excavations, 1926–28',
    heldBy: 'The Metropolitan Museum of Art',
    metadataLicense: 'CC0 1.0',
    sourceUrl: 'https://www.metmuseum.org/art/collection/search/1',
    accessionNumber: '31.3.166',
    tags: ['Sphinx'],
    quality: 0.8,
    fame: 0.7,
    lastSyncedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
    origin,
    image,
  };
}

/** A pool of artifacts spread across regions, eras and providers. */
export function makePool(count: number): Artifact[] {
  const spots = [
    { lat: 25.7, lon: 32.6, country: 'Egypt', culture: 'Egyptian', year: -1400 },
    { lat: 36.1, lon: 43.3, country: 'Iraq', culture: 'Assyrian', year: -800 },
    { lat: 37.97, lon: 23.73, country: 'Greece', culture: 'Greek', year: -450 },
    { lat: 41.89, lon: 12.48, country: 'Italy', culture: 'Roman', year: 100 },
    { lat: 34.34, lon: 108.94, country: 'China', culture: 'Han', year: 50 },
    { lat: 19.69, lon: -98.84, country: 'Mexico', culture: 'Teotihuacan', year: 400 },
    { lat: -8.15, lon: -78.99, country: 'Peru', culture: 'Moche', year: 300 },
    { lat: 27.33, lon: 68.13, country: 'Pakistan', culture: 'Indus', year: -2500 },
    { lat: 55.0, lon: -2.0, country: 'United Kingdom', culture: 'Romano-British', year: 200 },
    { lat: 6.33, lon: 5.62, country: 'Nigeria', culture: 'Benin', year: 1500 },
  ];
  const providers: ProviderId[] = ['met', 'cma', 'aic', 'wikidata'];

  return Array.from({ length: count }, (_, index) => {
    const spot = spots[index % spots.length]!;
    const provider = providers[index % providers.length]!;
    return makeArtifact({
      id: `${provider}:${index}`,
      provider,
      providerObjectId: String(index),
      title: `Object ${index}`,
      culture: spot.culture,
      yearStart: spot.year,
      yearEnd: spot.year,
      // Nudge each repeat of a spot far enough apart to be a distinct place.
      origin: {
        lat: spot.lat + Math.floor(index / spots.length) * 0.05,
        lon: spot.lon + Math.floor(index / spots.length) * 0.05,
        label: `Site ${index}, ${spot.country}`,
        country: spot.country,
        tier: 'site',
        kind: 'findspot',
        confidence: 0.9,
        uncertaintyKm: 30,
        resolvedBy: 'curated',
        resolvedId: null,
      },
      fame: 0.5,
      image: {
        url: `https://example.test/${index}.jpg`,
        alternates: [],
        verifiedAt: null,
        thumbUrl: `https://example.test/${index}-thumb.jpg`,
        width: 1200,
        height: 900,
        license: 'CC0 1.0',
        attribution: 'Test',
      },
    });
  });
}
