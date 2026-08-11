import type { DifficultyId } from './selection';

/**
 * Local persistence.
 *
 * Everything here is a convenience, never a requirement: private-mode browsers
 * and storage-quota failures must not break a session, so every read and write
 * is guarded and falls back to in-memory defaults.
 */

const KEY = 'relic.profile.v1';
/** Artifacts to remember as "recently seen" so they are not repeated. */
const HISTORY_LIMIT = 240;

export interface DailyRecord {
  /** YYYY-MM-DD of the challenge. */
  date: string;
  score: number;
}

export interface Profile {
  /** Highest session score per difficulty. */
  bests: Partial<Record<DifficultyId, number>>;
  gamesPlayed: number;
  /** Most recent artifact ids, newest last. */
  seen: string[];
  daily: DailyRecord | null;
  /** Consecutive days a daily challenge was completed. */
  dailyStreak: number;
  theme: 'system' | 'light' | 'dark';
}

const DEFAULT_PROFILE: Profile = {
  bests: {},
  gamesPlayed: 0,
  seen: [],
  daily: null,
  dailyStreak: 0,
  theme: 'system',
};

function storage(): Storage | null {
  try {
    const test = '__relic__';
    window.localStorage.setItem(test, test);
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    // Safari private mode, disabled storage, or an exhausted quota.
    return null;
  }
}

export function loadProfile(): Profile {
  const store = storage();
  if (!store) return { ...DEFAULT_PROFILE };
  try {
    const raw = store.getItem(KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      bests: parsed.bests ?? {},
      seen: Array.isArray(parsed.seen) ? parsed.seen.slice(-HISTORY_LIMIT) : [],
    };
  } catch {
    // Corrupt payload from an older version: start clean rather than crash.
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(profile: Profile): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Out of quota — the session continues without persistence.
  }
}

export function recordSeen(profile: Profile, ids: readonly string[]): Profile {
  const seen = [...profile.seen.filter((id) => !ids.includes(id)), ...ids].slice(-HISTORY_LIMIT);
  return { ...profile, seen };
}

/**
 * Records a finished session. The daily streak only advances when the completed
 * challenge is for today and the previous record was for yesterday.
 */
export function recordSession(
  profile: Profile,
  options: { difficulty: DifficultyId; score: number; dailyDate?: string | null },
): Profile {
  const previousBest = profile.bests[options.difficulty] ?? 0;
  let next: Profile = {
    ...profile,
    gamesPlayed: profile.gamesPlayed + 1,
    bests: {
      ...profile.bests,
      [options.difficulty]: Math.max(previousBest, options.score),
    },
  };

  if (options.dailyDate) {
    const wasYesterday = profile.daily ? isDayBefore(profile.daily.date, options.dailyDate) : false;
    const alreadyToday = profile.daily?.date === options.dailyDate;
    next = {
      ...next,
      daily: { date: options.dailyDate, score: options.score },
      dailyStreak: alreadyToday ? profile.dailyStreak : wasYesterday ? profile.dailyStreak + 1 : 1,
    };
  }

  return next;
}

export function isDayBefore(earlier: string, later: string): boolean {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b - a === 86_400_000;
}
