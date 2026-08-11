import { describe, expect, it } from 'vitest';
import {
  joinPlaceParts,
  stripHtml,
  summarize,
  tidyMaterial,
  tidyPlaceName,
  titleKey,
} from './text';

describe('stripHtml', () => {
  it('removes tags and decodes entities providers actually emit', () => {
    expect(stripHtml('<p>Gold &amp; lapis</p>')).toBe('Gold & lapis');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
    expect(stripHtml('1500&ndash;1200 BCE')).toBe('1500–1200 BCE');
    expect(stripHtml('Amenhotep&rsquo;s')).toBe('Amenhotep’s');
  });

  it('turns block breaks into spaces rather than joining words', () => {
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One Two');
    expect(stripHtml('One<br>Two')).toBe('One Two');
  });

  it('handles null and empty input', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(stripHtml('&unknownthing;')).toBe('&unknownthing;');
  });
});

describe('summarize', () => {
  it('returns short text unchanged', () => {
    expect(summarize('A short note.')).toBe('A short note.');
  });

  it('cuts on a sentence boundary when there is one', () => {
    const text = `${'x'.repeat(200)}. ${'y'.repeat(400)}`;
    expect(summarize(text, 300)!.endsWith('.')).toBe(true);
  });

  it('falls back to a word boundary with an ellipsis', () => {
    const text = 'word '.repeat(200);
    const result = summarize(text, 100)!;
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(140);
  });

  it('returns null for empty input', () => {
    expect(summarize('')).toBeNull();
    expect(summarize(null)).toBeNull();
  });
});

describe('tidyMaterial', () => {
  it('capitalises and caps the number of components', () => {
    expect(tidyMaterial('gypsum alabaster, paint, gold leaf, wood, resin')).toBe(
      'Gypsum alabaster, paint, gold leaf',
    );
  });

  it('returns null when there is nothing to show', () => {
    expect(tidyMaterial('')).toBeNull();
    expect(tidyMaterial(null)).toBeNull();
  });
});

describe('titleKey', () => {
  it('normalises for duplicate detection', () => {
    expect(titleKey('The Rosetta Stone')).toBe(titleKey('Rosetta stone'));
    expect(titleKey('Fragment of a Bowl')).toBe(titleKey('Bowl'));
  });

  it('strips diacritics', () => {
    expect(titleKey('Stèle')).toBe('stele');
  });

  it('keeps genuinely different titles apart', () => {
    expect(titleKey('Amphora')).not.toBe(titleKey('Krater'));
  });
});

describe('tidyPlaceName', () => {
  it('turns a Pleiades name variant into a parenthetical', () => {
    expect(tidyPlaceName('Nev-Shapur/Nishapur')).toBe('Nev-Shapur (Nishapur)');
    expect(tidyPlaceName('Consabura/Consabrum')).toBe('Consabura (Consabrum)');
  });

  it('leaves a single name alone', () => {
    expect(tidyPlaceName(' Nimrud ')).toBe('Nimrud');
  });

  it('collapses internal whitespace', () => {
    expect(tidyPlaceName('Deir  el-Bahri')).toBe('Deir el-Bahri');
  });
});

describe('joinPlaceParts', () => {
  it('does not repeat a segment the gazetteer label already carries', () => {
    // The bug this guards: "Thebes, Egypt, Upper Egypt, Egypt".
    expect(joinPlaceParts(['Thebes, Egypt', 'Upper Egypt', 'Egypt'])).toBe(
      'Thebes, Egypt, Upper Egypt',
    );
  });

  it('is accent- and case-insensitive when de-duplicating', () => {
    expect(joinPlaceParts(['Türkiye', 'turkiye'])).toBe('Türkiye');
  });

  it('caps the number of segments', () => {
    expect(joinPlaceParts(['A', 'B', 'C', 'D'], 2)).toBe('A, B');
  });

  it('skips null and empty parts', () => {
    expect(joinPlaceParts([null, 'Athens', undefined, '', 'Greece'])).toBe('Athens, Greece');
  });

  it('returns an empty string when there is nothing usable', () => {
    expect(joinPlaceParts([null, '  ', ','])).toBe('');
  });
});
