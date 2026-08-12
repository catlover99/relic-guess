/** Deterministic PRNG so daily challenges and tests are reproducible. */
export type Rng = () => number;

/** mulberry32 — small, fast, good enough distribution for shuffling. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for turning a date string or mode key into a seed. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rngFromSeed(seed: string | number): Rng {
  return mulberry32(typeof seed === 'number' ? seed : hashString(seed));
}

/** Fisher–Yates, non-mutating. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pickOne<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/**
 * Day 1 of the daily challenge.
 *
 * Fixed forever: the number printed in a shared result has to mean the same thing
 * next year as it does today, so this date can never be edited without renumbering
 * every result anyone has already posted.
 */
export const DAILY_EPOCH = '2026-08-01';

/**
 * The sequential daily challenge number, counting from `DAILY_EPOCH`.
 *
 * Both dates are parsed as UTC midnight rather than local time, so the difference
 * is always a whole number of days regardless of the player's timezone or a
 * daylight-saving transition in between.
 */
export function dailyNumber(key: string = todayKey()): number {
  const day = Date.parse(`${key}T00:00:00Z`);
  const epoch = Date.parse(`${DAILY_EPOCH}T00:00:00Z`);
  if (Number.isNaN(day) || Number.isNaN(epoch)) return 1;
  return Math.max(1, Math.round((day - epoch) / 86_400_000) + 1);
}

/** Local calendar date as YYYY-MM-DD — the daily challenge seed. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
