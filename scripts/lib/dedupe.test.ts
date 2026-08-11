import { describe, expect, it } from 'vitest';
import { dedupe } from './dedupe';
import { makeArtifact } from '../../src/test/factories';

describe('dedupe', () => {
  it('keeps distinct artifacts', () => {
    const a = makeArtifact({ id: 'met:1', title: 'Sphinx of Hatshepsut' });
    const b = makeArtifact({
      id: 'cma:2',
      provider: 'cma',
      title: 'Paint Box of Vizier Amenemope',
      accessionNumber: '1914.680',
      image: {
        ...a.image,
        url: 'https://example.test/b.jpg',
        thumbUrl: 'https://example.test/b.jpg',
      },
    });
    expect(dedupe([a, b]).kept).toHaveLength(2);
  });

  it('removes exact duplicate ids', () => {
    const a = makeArtifact({ id: 'met:1' });
    const result = dedupe([a, { ...a }]);
    expect(result.kept).toHaveLength(1);
    expect(result.removed[0]!.rule).toBe('duplicate-id');
  });

  it('removes records sharing an accession number within a provider', () => {
    const a = makeArtifact({ id: 'met:1', accessionNumber: '31.3.166' });
    const b = makeArtifact({
      id: 'met:2',
      title: 'Something else entirely',
      accessionNumber: '31.3.166 ',
      image: { ...a.image, url: 'https://example.test/other.jpg' },
    });
    const result = dedupe([a, b]);
    expect(result.kept).toHaveLength(1);
    expect(result.removed[0]!.rule).toBe('accession-number');
  });

  it('treats an identical image URL as conclusive', () => {
    // The same file cannot depict two different objects.
    const a = makeArtifact({ id: 'met:1', title: 'One thing', accessionNumber: 'A1' });
    const b = makeArtifact({
      id: 'cma:9',
      provider: 'cma',
      title: 'Another thing',
      accessionNumber: 'B2',
    });
    const result = dedupe([a, b]);
    expect(result.kept).toHaveLength(1);
    expect(result.removed[0]!.rule).toBe('image-url');
  });

  it('collapses the same famous object held by two providers', () => {
    const met = makeArtifact({
      id: 'met:1',
      title: 'The Rosetta Stone',
      accessionNumber: 'A',
      quality: 0.9,
    });
    const wikidata = makeArtifact({
      id: 'wikidata:Q48584',
      provider: 'wikidata',
      title: 'Rosetta stone',
      accessionNumber: null,
      quality: 0.5,
      image: { ...met.image, url: 'https://commons.test/rosetta.jpg' },
    });
    const result = dedupe([met, wikidata]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.id).toBe('met:1');
    expect(result.removed[0]!.rule).toBe('cross-provider-title');
  });

  it('keeps the higher-quality record when collapsing', () => {
    const poor = makeArtifact({
      id: 'wikidata:Q1',
      provider: 'wikidata',
      quality: 0.2,
      accessionNumber: null,
    });
    const rich = makeArtifact({
      id: 'met:1',
      quality: 0.95,
      accessionNumber: 'A',
      image: { ...poor.image, url: 'https://example.test/rich.jpg' },
    });
    expect(dedupe([poor, rich]).kept[0]!.id).toBe('met:1');
  });

  it('does not merge same-titled objects from distant places', () => {
    // "Amulet" is a generic title; two amulets from Egypt and Peru are two objects.
    const egypt = makeArtifact({ id: 'met:1', title: 'Amulet', accessionNumber: 'A' });
    const peru = makeArtifact({
      id: 'cma:2',
      provider: 'cma',
      title: 'Amulet',
      accessionNumber: 'B',
      culture: 'Moche',
      origin: { lat: -8.15, lon: -78.99, label: 'Moche, Peru', country: 'Peru' },
      image: { ...egypt.image, url: 'https://example.test/peru.jpg' },
    });
    expect(dedupe([egypt, peru]).kept).toHaveLength(2);
  });

  it('does not merge same-titled objects from different eras at one site', () => {
    const early = makeArtifact({
      id: 'met:1',
      title: 'Statuette',
      accessionNumber: 'A',
      yearStart: -2500,
      yearEnd: -2400,
    });
    const late = makeArtifact({
      id: 'cma:2',
      provider: 'cma',
      title: 'Statuette',
      accessionNumber: 'B',
      yearStart: 600,
      yearEnd: 700,
      culture: 'Coptic',
      image: { ...early.image, url: 'https://example.test/late.jpg' },
    });
    expect(dedupe([early, late]).kept).toHaveLength(2);
  });

  it('handles an empty input', () => {
    expect(dedupe([])).toEqual({ kept: [], removed: [] });
  });

  it('is stable: every input is either kept or reported removed', () => {
    const pool = Array.from({ length: 10 }, (_, index) =>
      makeArtifact({
        id: `met:${index}`,
        title: index % 2 === 0 ? 'Repeated title' : `Unique ${index}`,
        accessionNumber: `ACC-${index}`,
        image: { ...makeArtifact().image, url: `https://example.test/${index}.jpg` },
      }),
    );
    const result = dedupe(pool);
    expect(result.kept.length + result.removed.length).toBe(pool.length);
  });
});
