import { formatScore, scoreBand, MAX_ROUND_SCORE, type ScoreBand } from './scoring';

/**
 * The shareable result.
 *
 * Built as a string here, rather than assembled in the component, so its exact
 * shape can be tested — a share block is a piece of copy that lands in someone
 * else's chat window, and "looks fine in the UI" is not the bar.
 *
 * Three rules it has to keep:
 *
 * 1. **No spoilers.** A daily result is posted by people who have played to
 *    people who have not. Only score bands appear — never a title, culture,
 *    country, coordinate or distance.
 * 2. **It says what it is.** "Relic", the challenge number, and the site, so a
 *    reader who has never heard of the game can find it. The URL is part of the
 *    copied *text*, not a link in the UI that a paste would drop.
 * 3. **It survives plain text.** No markdown, no box drawing, no leading spaces:
 *    it has to look deliberate in iMessage, Discord and a tweet alike.
 */

const BAND_SQUARE: Record<ScoreBand, string> = {
  bullseye: '🟩',
  excellent: '🟩',
  strong: '🟨',
  close: '🟧',
  far: '🟥',
  lost: '⬛',
};

export const SHARE_SITE = 'RelicGuess.com';

export interface ShareOptions {
  scores: readonly number[];
  /** Daily challenge number; omitted for a normal game. */
  dailyNumber?: number;
  /** Mode name, used as the subtitle of a non-daily result. */
  modeLabel?: string;
}

export function buildShareText({ scores, dailyNumber, modeLabel }: ShareOptions): string {
  const total = scores.reduce((sum, score) => sum + score, 0);
  const possible = scores.length * MAX_ROUND_SCORE;
  const squares = scores.map((score) => BAND_SQUARE[scoreBand(score).id]).join('');

  const heading =
    dailyNumber !== undefined
      ? `Relic — Daily #${dailyNumber}`
      : modeLabel
        ? `Relic — ${modeLabel}`
        : 'Relic';

  return [
    heading,
    `${formatScore(total)} / ${formatScore(possible)}`,
    squares,
    '',
    SHARE_SITE,
  ].join('\n');
}
