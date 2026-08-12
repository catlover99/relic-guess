import { create } from 'zustand';
import type { Artifact, ArtifactBundle, GeoPoint } from '@/data/schema';
import { parseBundle } from '@/data/schema';
import { scoreGuess, type ScoreBreakdown } from './scoring';
import { DEFAULT_DIFFICULTY, toleranceFor, type DifficultyId } from './selection';
import { roundGeography, type RoundGeography } from './geography';
import { buildSession, findReplacement } from './session';
import { markImageUnavailable, resolveArtifactImage } from './imageValidation';
import type { RegionId } from './regions';
import type { EraId } from './eras';
import { todayKey } from './random';
import { loadProfile, recordSeen, recordSession, saveProfile, type Profile } from './persist';

/**
 * `preparing` covers the gap between "start" and the first playable round, while
 * photographs are being verified. It is a distinct phase from `loading` (fetching the
 * bundle) so the UI can explain what is happening.
 */
export type Phase = 'loading' | 'error' | 'menu' | 'preparing' | 'playing' | 'revealed' | 'summary';
export type GameMode = 'classic' | 'daily';

export const ROUNDS_PER_SESSION = 5;

export interface SessionConfig {
  mode: GameMode;
  difficulty: DifficultyId;
  region: RegionId | null;
  era: EraId | null;
}

export interface RoundResult {
  artifact: Artifact;
  guess: GeoPoint;
  breakdown: ScoreBreakdown;
  /**
   * What the round meant geographically, resolved once when the guess was
   * submitted.
   *
   * Carried on the result rather than recomputed by the map and the reveal panel
   * separately: they must agree about which point was scored, and the mode can
   * change before the player leaves the summary screen.
   */
  geography: RoundGeography;
}

interface GameState {
  phase: Phase;
  errorMessage: string | null;

  pool: Artifact[];
  sources: ArtifactBundle['sources'];
  /** Records dropped by validation on load — surfaced in the credits panel. */
  droppedOnLoad: number;

  profile: Profile;
  config: SessionConfig;

  rounds: Artifact[];
  roundIndex: number;
  guess: GeoPoint | null;
  results: RoundResult[];
  /** Incremented per round so the map knows to reset its viewport. */
  viewEpoch: number;

  /**
   * The rendition confirmed loadable for each artifact in play, by artifact id.
   *
   * The UI renders from this rather than from `artifact.image.url`, so it can only
   * ever display a photograph that has already loaded once in this browser.
   */
  imageUrls: Record<string, string>;
  /** Artifacts whose photographs failed this session; never offered again. */
  unusableArtifactIds: string[];
  /** True while a dead photograph is being swapped for a fresh artifact. */
  replacingRound: boolean;

  /**
   * How a photograph is verified. Injected rather than imported directly so tests can
   * drive the selection lifecycle without a browser — jsdom's `Image` never fires
   * `load` or `error`, so the real probe would simply time out.
   */
  verifyImage: (artifact: Artifact) => Promise<string | null>;

  loadPool: () => Promise<void>;
  openMenu: () => void;
  setConfig: (patch: Partial<SessionConfig>) => void;
  startSession: (config?: Partial<SessionConfig>) => Promise<void>;
  /** Called by the UI when a presented photograph fails; swaps in a new artifact. */
  reportImageFailure: (artifactId: string, url: string) => Promise<void>;
  /**
   * Called when look-ahead verification finds an upcoming photograph is dead. The
   * artifact is swapped before the player ever reaches it.
   */
  reportUpcomingImageFailure: (artifactId: string) => Promise<void>;
  setGuess: (point: GeoPoint) => void;
  clearGuess: () => void;
  submitGuess: () => void;
  nextRound: () => void;
  setTheme: (theme: Profile['theme']) => void;
}

/** What a first-time visitor plays before touching any control. */
export const DEFAULT_CONFIG: SessionConfig = {
  mode: 'classic',
  difficulty: DEFAULT_DIFFICULTY,
  region: null,
  era: null,
};

export const useGame = create<GameState>((set, get) => ({
  phase: 'loading',
  errorMessage: null,
  pool: [],
  sources: [],
  droppedOnLoad: 0,
  profile: loadProfile(),
  config: DEFAULT_CONFIG,
  rounds: [],
  roundIndex: 0,
  guess: null,
  results: [],
  viewEpoch: 0,
  imageUrls: {},
  unusableArtifactIds: [],
  replacingRound: false,
  verifyImage: resolveArtifactImage,

  async loadPool() {
    set({ phase: 'loading', errorMessage: null });
    try {
      /*
       * `cache: 'no-cache'` forces a conditional request, not a re-download: the
       * browser sends `If-None-Match` and the server answers 304 when the bundle is
       * unchanged, so a returning player pays one small round trip and nothing else.
       *
       * This was `force-cache`, which was actively harmful. The URL never changes, so
       * the browser reused its stored copy indefinitely and *no* data correction could
       * ever reach anyone who had already loaded the game — a resolver fix that was
       * verified correct on disk still showed the old wrong answer in the browser.
       *
       * The stronger fix is a content-hashed filename (immutable caching plus
       * automatic invalidation), which means moving the generated bundle out of
       * `public/` so Vite can hash it. Worth doing; revalidation is correct meanwhile.
       */
      const response = await fetch(`${import.meta.env.BASE_URL}data/artifacts.json`, {
        cache: 'no-cache',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await response.json()) as ArtifactBundle;
      const { artifacts, dropped } = parseBundle(raw);

      if (artifacts.length < ROUNDS_PER_SESSION) {
        throw new Error(
          `Only ${artifacts.length} valid artifacts found; at least ${ROUNDS_PER_SESSION} are needed.`,
        );
      }

      set({
        pool: artifacts,
        sources: Array.isArray(raw.sources) ? raw.sources : [],
        droppedOnLoad: dropped,
        phase: 'menu',
      });
    } catch (error) {
      set({
        phase: 'error',
        errorMessage:
          error instanceof Error ? error.message : 'The artifact collection could not be loaded.',
      });
    }
  },

  openMenu() {
    set({
      phase: 'menu',
      rounds: [],
      results: [],
      roundIndex: 0,
      guess: null,
      replacingRound: false,
    });
  },

  setConfig(patch) {
    set({ config: { ...get().config, ...patch } });
  },

  async startSession(patch) {
    const state = get();
    const config = { ...state.config, ...patch };

    // The daily challenge is the same five artifacts worldwide, so it is seeded
    // by date and ignores the region/era filters.
    const isDaily = config.mode === 'daily';
    const effectiveConfig: SessionConfig = isDaily
      ? /*
         * The daily is the mode most people meet first, so it plays by the same
         * forgiving rules as the default: name the region, not the trench. Fixing
         * the difficulty here is also what keeps it identical for everyone —
         * whatever the player last chose in the menu must not leak into it.
         */
        { mode: 'daily', difficulty: DEFAULT_DIFFICULTY, region: null, era: null }
      : config;

    const seed = isDaily ? `daily:${todayKey()}` : `session:${Date.now()}:${Math.random()}`;

    set({ phase: 'preparing', errorMessage: null, config: effectiveConfig });

    /*
     * The daily draws only from artifacts the ingest confirmed loadable, when any
     * exist. Runtime verification still runs — third-party images vanish after the
     * bundle is built — but starting from a pre-verified pool means the runtime check
     * almost never rejects anything, which is what keeps everyone's puzzle identical.
     */
    const verifiedPool = state.pool.filter((a) => a.image.verifiedAt !== null);
    const pool = isDaily && verifiedPool.length >= ROUNDS_PER_SESSION ? verifiedPool : state.pool;

    const built = await buildSession({
      pool,
      seed,
      rounds: ROUNDS_PER_SESSION,
      difficulty: effectiveConfig.difficulty,
      region: effectiveConfig.region,
      era: effectiveConfig.era,
      /*
       * The daily must be identical for everyone, so neither personal history nor
       * this browser's past image failures may influence it.
       */
      exclude: isDaily ? [] : [...state.profile.seen, ...state.unusableArtifactIds],
      verify: state.verifyImage,
    });

    if (built.rounds.length < ROUNDS_PER_SESSION) {
      /*
       * Two genuinely different failures, and the player can act on only one of them:
       * too-narrow filters are theirs to widen, dead photographs are not their fault.
       */
      const noCandidates = built.eligibleCount < ROUNDS_PER_SESSION;
      set({
        phase: 'error',
        errorMessage: noCandidates
          ? 'No artifacts match those filters. Try a different region or period.'
          : "We couldn't find enough artifacts with available photographs. Try another game mode.",
      });
      return;
    }

    set({
      config: effectiveConfig,
      rounds: built.rounds,
      imageUrls: built.imageUrls,
      unusableArtifactIds: [...new Set([...get().unusableArtifactIds, ...built.rejected])],
      roundIndex: 0,
      guess: null,
      results: [],
      replacingRound: false,
      phase: 'playing',
      viewEpoch: get().viewEpoch + 1,
    });
  },

  /**
   * Replaces the current round when its photograph dies after being presented.
   *
   * The round was shown because the image loaded during preparation, so reaching here
   * means a CDN expired a URL or the network dropped mid-session. The player must
   * never be asked to guess without a photograph, so the artifact is swapped rather
   * than annotated with an error.
   */
  async reportImageFailure(artifactId, url) {
    const state = get();
    if (state.replacingRound) return;
    // Only the artifact currently on screen matters; a stale event from a previous
    // round would otherwise reshuffle the session underneath the player.
    const current = state.rounds[state.roundIndex];
    if (!current || current.id !== artifactId) return;
    // Once revealed the round is already scored; the answer stands.
    if (state.phase !== 'playing') return;

    markImageUnavailable(url);
    set({ replacingRound: true });

    // Another rendition of the same artifact may still work.
    const alternative = await state.verifyImage(current);
    if (alternative && alternative !== url) {
      set({
        imageUrls: { ...get().imageUrls, [current.id]: alternative },
        replacingRound: false,
      });
      return;
    }

    const excluded = [
      ...get().unusableArtifactIds,
      ...get().rounds.map((a) => a.id),
      ...get().results.map((r) => r.artifact.id),
    ];

    const replacement = await findReplacement({
      pool: get().pool,
      exclude: excluded,
      seed: `replace:${artifactId}:${Date.now()}`,
      difficulty: get().config.difficulty,
      region: get().config.region,
      era: get().config.era,
      verify: get().verifyImage,
    });

    if (!replacement) {
      set({
        phase: 'error',
        replacingRound: false,
        errorMessage:
          "We couldn't find enough artifacts with available photographs. Try another game mode.",
      });
      return;
    }

    const rounds = get().rounds.slice();
    rounds[get().roundIndex] = replacement.artifact;

    set({
      rounds,
      imageUrls: { ...get().imageUrls, [replacement.artifact.id]: replacement.imageUrl },
      unusableArtifactIds: [...new Set([...get().unusableArtifactIds, artifactId])],
      guess: null,
      replacingRound: false,
      // A different artifact is a different round: reset the map.
      viewEpoch: get().viewEpoch + 1,
    });
  },

  async reportUpcomingImageFailure(artifactId) {
    const state = get();
    const index = state.rounds.findIndex((a) => a.id === artifactId);
    // Only rounds still ahead of the player: the current one is handled by
    // `reportImageFailure`, and past rounds are already scored.
    if (index <= state.roundIndex) return;

    const excluded = [
      ...state.unusableArtifactIds,
      ...state.rounds.map((a) => a.id),
      ...state.results.map((r) => r.artifact.id),
    ];

    const replacement = await findReplacement({
      pool: state.pool,
      exclude: excluded,
      seed: `replace-upcoming:${artifactId}`,
      difficulty: state.config.difficulty,
      region: state.config.region,
      era: state.config.era,
      verify: state.verifyImage,
    });

    // No replacement available is not fatal here — the round is still in the future,
    // and `reportImageFailure` will handle it if the player actually reaches it.
    if (!replacement) {
      set({ unusableArtifactIds: [...new Set([...get().unusableArtifactIds, artifactId])] });
      return;
    }

    const rounds = get().rounds.slice();
    rounds[index] = replacement.artifact;
    set({
      rounds,
      imageUrls: { ...get().imageUrls, [replacement.artifact.id]: replacement.imageUrl },
      unusableArtifactIds: [...new Set([...get().unusableArtifactIds, artifactId])],
    });
  },

  setGuess(point) {
    if (get().phase !== 'playing') return;
    set({ guess: point });
  },

  clearGuess() {
    if (get().phase !== 'playing') return;
    set({ guess: null });
  },

  submitGuess() {
    const { phase, guess, rounds, roundIndex, results } = get();
    if (phase !== 'playing' || !guess) return;
    const artifact = rounds[roundIndex];
    if (!artifact) return;

    /*
     * What the round is graded against is a geography question, not a scoring
     * one, so it is answered in one place. Heartland and Daily grade against the
     * culture's homeland; the precise modes grade against the object's own
     * recorded place. Either way the scorer sees a centre and a radius.
     */
    const geography = roundGeography(artifact, get().config.difficulty);
    const breakdown = scoreGuess(
      guess,
      {
        lat: geography.region.lat,
        lon: geography.region.lon,
        uncertaintyKm: geography.region.radiusKm,
      },
      { minToleranceKm: toleranceFor(get().config.difficulty) },
    );
    set({
      phase: 'revealed',
      results: [...results, { artifact, guess, breakdown, geography }],
    });
  },

  nextRound() {
    const state = get();
    if (state.phase !== 'revealed') return;

    const isLastRound = state.roundIndex >= state.rounds.length - 1;
    if (!isLastRound) {
      set({
        roundIndex: state.roundIndex + 1,
        guess: null,
        phase: 'playing',
        viewEpoch: state.viewEpoch + 1,
      });
      return;
    }

    const total = state.results.reduce((sum, result) => sum + result.breakdown.score, 0);
    let profile = recordSeen(
      state.profile,
      state.rounds.map((artifact) => artifact.id),
    );
    profile = recordSession(profile, {
      difficulty: state.config.difficulty,
      score: total,
      dailyDate: state.config.mode === 'daily' ? todayKey() : null,
    });
    saveProfile(profile);

    set({ phase: 'summary', profile });
  },

  setTheme(theme) {
    const profile = { ...get().profile, theme };
    saveProfile(profile);
    set({ profile });
  },
}));

/* ---- Derived selectors ------------------------------------------ */

export const selectCurrentArtifact = (state: GameState): Artifact | null =>
  state.rounds[state.roundIndex] ?? null;

export const selectCurrentResult = (state: GameState): RoundResult | null =>
  state.phase === 'revealed' ? (state.results[state.results.length - 1] ?? null) : null;

export const selectTotalScore = (state: GameState): number =>
  state.results.reduce((sum, result) => sum + result.breakdown.score, 0);

export const selectIsLastRound = (state: GameState): boolean =>
  state.roundIndex >= state.rounds.length - 1;

/** How many rounds ahead photographs are warmed and re-checked. */
export const PREFETCH_WINDOW = 2;

/**
 * The upcoming artifacts whose photographs are worth warming.
 *
 * Two rounds ahead, not five: a session that is abandoned after round one should not
 * have pulled five full-resolution photographs, and two is far enough ahead that a
 * photograph which died since the session was built is discovered — and replaced —
 * before the player reaches it.
 */
export function upcomingArtifacts(rounds: readonly Artifact[], roundIndex: number): Artifact[] {
  return rounds.slice(roundIndex + 1, roundIndex + 1 + PREFETCH_WINDOW);
}
