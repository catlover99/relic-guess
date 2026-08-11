import { describe, expect, it } from 'vitest';
import { candidateNames, isGenericDescriptor, normalizePlaceKey } from './gazetteer';

describe('normalizePlaceKey', () => {
  it('lower-cases and trims', () => {
    expect(normalizePlaceKey('  Nimrud  ')).toBe('nimrud');
  });

  it('strips diacritics so provider spellings match', () => {
    expect(normalizePlaceKey('Çatalhöyük')).toBe('catalhoyuk');
    expect(normalizePlaceKey('Bābili')).toBe('babili');
  });

  it('drops parenthetical qualifiers', () => {
    // The Met writes "Nimrud (ancient Kalhu)"; the gazetteer holds "Nimrud".
    expect(normalizePlaceKey('Nimrud (ancient Kalhu)')).toBe('nimrud');
  });

  it('collapses punctuation and whitespace', () => {
    expect(normalizePlaceKey('Deir  el-Bahri,')).toBe('deir el-bahri');
  });

  it('keeps apostrophes, which appear in real place names', () => {
    expect(normalizePlaceKey("Xi'an")).toBe("xi'an");
  });

  it('returns empty for punctuation-only input', () => {
    expect(normalizePlaceKey('---')).toBe('');
  });
});

describe('candidateNames', () => {
  it('returns the narrowest segment first', () => {
    // Providers comma-join hierarchies coarse-to-fine, so reversing puts the
    // most specific place at the front.
    const names = candidateNames('Upper Egypt, Thebes, Deir el-Bahri');
    expect(names[0]).toBe('Deir el-Bahri');
    expect(names).toContain('Upper Egypt');
  });

  it('includes the whole string as a fallback', () => {
    expect(candidateNames('Thebes, Egypt')).toContain('Thebes, Egypt');
  });

  it('handles a single place with no separators', () => {
    expect(candidateNames('Nimrud')).toEqual(['Nimrud']);
  });

  it('strips hedging prefixes', () => {
    expect(candidateNames('probably Athens')).toContain('Athens');
  });

  it('splits on semicolons and pipes as well as commas', () => {
    expect(candidateNames('Egypt; Amarna')).toContain('Amarna');
    expect(candidateNames('Iraq|Nimrud')).toContain('Nimrud');
  });

  it('drops one-character fragments', () => {
    expect(candidateNames('Egypt, X')).not.toContain('X');
  });

  it('deduplicates', () => {
    const names = candidateNames('Athens');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('isGenericDescriptor', () => {
  it('rejects the descriptors that produced wrong matches', () => {
    // "North Coast" reached a Danish municipality for a Peruvian object; "Southwest"
    // put an Ancestral Pueblo vessel in Africa.
    expect(isGenericDescriptor('north coast')).toBe(true);
    expect(isGenericDescriptor('southwest')).toBe(true);
    expect(isGenericDescriptor('highlands')).toBe(true);
    expect(isGenericDescriptor('central')).toBe(true);
    expect(isGenericDescriptor('unknown')).toBe(true);
  });

  it('leaves real place names alone', () => {
    for (const name of [
      'nimrud',
      'attica',
      'north sea',
      'northampton',
      'south sumatra',
      'westminster',
    ]) {
      expect(isGenericDescriptor(name), name).toBe(false);
    }
  });
});
