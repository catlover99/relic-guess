import { describe, expect, it } from 'vitest';
import { buildShareText, SHARE_SITE } from './share';
import { dailyNumber, DAILY_EPOCH } from './random';

/**
 * The share block is copy that lands in someone else's chat window, so it is
 * tested as text: exact lines, exact order, and above all no spoilers.
 */

const GOOD_SESSION = [4900, 4400, 3400, 1800, 350];

describe('buildShareText — daily', () => {
  const text = buildShareText({ scores: GOOD_SESSION, dailyNumber: 123 });
  const lines = text.split('\n');

  it('names the game and the challenge on the first line', () => {
    expect(lines[0]).toBe('Relic — Daily #123');
  });

  it('shows the total against the maximum', () => {
    expect(lines[1]).toBe('14,850 / 25,000');
  });

  it('ends with the site, in the copied text itself', () => {
    expect(lines[lines.length - 1]).toBe(SHARE_SITE);
    expect(text).toContain('RelicGuess.com');
  });

  it('includes one spoiler-free square per round', () => {
    expect([...lines[2]!]).toHaveLength(GOOD_SESSION.length);
  });

  it('is five lines: heading, score, squares, blank, site', () => {
    expect(lines).toHaveLength(5);
    expect(lines[3]).toBe('');
  });

  it('uses no markdown or leading whitespace', () => {
    for (const line of lines) {
      expect(line).toBe(line.trimStart());
      expect(line).not.toMatch(/[*_`|]/);
    }
  });
});

describe('buildShareText — spoilers', () => {
  it('contains nothing but the score, the squares and the site', () => {
    const text = buildShareText({ scores: GOOD_SESSION, dailyNumber: 7 });
    // Anything identifying an artifact, a place or a distance would give the
    // daily away to someone who has not played it yet.
    for (const leak of ['Egypt', 'Thebes', 'Sphinx', 'km', 'Bullseye', 'lat', 'Greek', 'Museum']) {
      expect(text).not.toContain(leak);
    }
    expect(text).not.toMatch(/\d+\s*km/);
    // No coordinate-looking decimals: the only numbers are the scores.
    expect(text).not.toMatch(/-?\d+\.\d+/);
  });

  it('cannot be distinguished by artifact between two equal-scoring sessions', () => {
    const a = buildShareText({ scores: [5000, 5000, 5000, 5000, 5000], dailyNumber: 7 });
    const b = buildShareText({ scores: [5000, 5000, 5000, 5000, 5000], dailyNumber: 7 });
    expect(a).toBe(b);
  });
});

describe('buildShareText — normal games', () => {
  it('is labelled by mode rather than pretending to be the daily', () => {
    const text = buildShareText({ scores: GOOD_SESSION, modeLabel: 'Heartland' });
    expect(text.split('\n')[0]).toBe('Relic — Heartland');
    expect(text).not.toContain('Daily');
    expect(text).toContain(SHARE_SITE);
  });

  it('falls back to the bare title with no mode', () => {
    expect(buildShareText({ scores: [0] }).split('\n')[0]).toBe('Relic');
  });

  it('handles a zero session without breaking the layout', () => {
    const lines = buildShareText({ scores: [0, 0, 0, 0, 0], modeLabel: 'Expert' }).split('\n');
    expect(lines[1]).toBe('0 / 25,000');
    expect(lines[2]).toBe('⬛⬛⬛⬛⬛');
  });
});

describe('dailyNumber', () => {
  it('starts at 1 on the epoch', () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
  });

  it('advances by one per calendar day', () => {
    expect(dailyNumber('2026-08-02')).toBe(2);
    expect(dailyNumber('2026-08-11')).toBe(11);
    expect(dailyNumber('2026-09-01')).toBe(32);
  });

  it('crosses a year boundary correctly', () => {
    expect(dailyNumber('2027-08-01')).toBe(366);
  });

  it('is stable for the same date', () => {
    expect(dailyNumber('2026-12-25')).toBe(dailyNumber('2026-12-25'));
  });

  it('never returns zero or a negative number for dates before the epoch', () => {
    expect(dailyNumber('2020-01-01')).toBe(1);
  });

  it('survives a malformed key rather than printing NaN', () => {
    expect(dailyNumber('not-a-date')).toBe(1);
  });
});
