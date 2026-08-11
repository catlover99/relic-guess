import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROUNDS_PER_SESSION,
  selectCurrentArtifact,
  selectCurrentResult,
  selectIsLastRound,
  upcomingArtifacts,
  selectTotalScore,
  useGame,
} from './store';
import { MAX_ROUND_SCORE } from './scoring';
import { makePool } from '@/test/factories';

const pool = makePool(80);

/**
 * Drives the store the way a player does, so the assertions are about the state
 * machine rather than about React.
 */
async function startGame() {
  useGame.setState({
    pool,
    phase: 'menu',
    results: [],
    rounds: [],
    roundIndex: 0,
    guess: null,
    verifyImage: async (artifact) => artifact.image.url,
  });
  await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
}

function playRound(point = { lat: 25.7, lon: 32.6 }) {
  useGame.getState().setGuess(point);
  useGame.getState().submitGuess();
}

describe('game store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGame.setState({
      phase: 'menu',
      errorMessage: null,
      pool,
      rounds: [],
      roundIndex: 0,
      guess: null,
      results: [],
      viewEpoch: 0,
      profile: {
        bests: {},
        gamesPlayed: 0,
        seen: [],
        daily: null,
        dailyStreak: 0,
        theme: 'system',
      },
    });
  });

  it('starts a session with a full set of rounds', async () => {
    await startGame();
    const state = useGame.getState();
    expect(state.phase).toBe('playing');
    expect(state.rounds).toHaveLength(ROUNDS_PER_SESSION);
    expect(state.roundIndex).toBe(0);
    expect(state.guess).toBeNull();
    expect(selectCurrentArtifact(state)).not.toBeNull();
  });

  it('records a guess and reveals on submit', async () => {
    await startGame();
    useGame.getState().setGuess({ lat: 25.7, lon: 32.6 });
    expect(useGame.getState().guess).toEqual({ lat: 25.7, lon: 32.6 });

    useGame.getState().submitGuess();
    const state = useGame.getState();
    expect(state.phase).toBe('revealed');
    expect(state.results).toHaveLength(1);
    expect(selectCurrentResult(state)).not.toBeNull();
  });

  it('refuses to submit without a guess', async () => {
    await startGame();
    useGame.getState().submitGuess();
    expect(useGame.getState().phase).toBe('playing');
    expect(useGame.getState().results).toHaveLength(0);
  });

  it('ignores a guess once the round is revealed', async () => {
    await startGame();
    playRound();
    const locked = useGame.getState().guess;
    useGame.getState().setGuess({ lat: 0, lon: 0 });
    expect(useGame.getState().guess).toEqual(locked);
  });

  it('advances to the next round and clears the guess', async () => {
    await startGame();
    playRound();
    const epochBefore = useGame.getState().viewEpoch;

    useGame.getState().nextRound();
    const state = useGame.getState();
    expect(state.phase).toBe('playing');
    expect(state.roundIndex).toBe(1);
    expect(state.guess).toBeNull();
    // Bumping the epoch is what resets the map viewport for the new round.
    expect(state.viewEpoch).toBeGreaterThan(epochBefore);
  });

  it('ignores nextRound while still playing', async () => {
    await startGame();
    useGame.getState().nextRound();
    expect(useGame.getState().roundIndex).toBe(0);
  });

  it('walks the full session to the summary screen', async () => {
    await startGame();
    for (let round = 0; round < ROUNDS_PER_SESSION; round++) {
      expect(useGame.getState().phase).toBe('playing');
      playRound();
      expect(useGame.getState().phase).toBe('revealed');
      useGame.getState().nextRound();
    }
    const state = useGame.getState();
    expect(state.phase).toBe('summary');
    expect(state.results).toHaveLength(ROUNDS_PER_SESSION);
  });

  it('flags the final round', async () => {
    await startGame();
    expect(selectIsLastRound(useGame.getState())).toBe(false);
    for (let round = 0; round < ROUNDS_PER_SESSION - 1; round++) {
      playRound();
      useGame.getState().nextRound();
    }
    expect(selectIsLastRound(useGame.getState())).toBe(true);
  });

  it('totals the score across rounds', async () => {
    await startGame();
    const artifact = selectCurrentArtifact(useGame.getState())!;
    // Guess exactly right on round one.
    playRound({ lat: artifact.origin.lat, lon: artifact.origin.lon });
    expect(selectTotalScore(useGame.getState())).toBe(MAX_ROUND_SCORE);
  });

  it('exposes a short queue of upcoming artifacts for image prefetching', async () => {
    await startGame();
    const state = useGame.getState();
    const upcoming = upcomingArtifacts(state.rounds, state.roundIndex);

    expect(upcoming.map((a) => a.id)).toEqual([state.rounds[1]!.id, state.rounds[2]!.id]);
    // Bounded: an abandoned session must not have pulled every photograph.
    expect(upcoming.length).toBeLessThan(state.rounds.length);
  });

  it('runs the prefetch queue dry at the end of the session', async () => {
    await startGame();
    useGame.setState({ roundIndex: useGame.getState().rounds.length - 1 });
    const state = useGame.getState();
    expect(upcomingArtifacts(state.rounds, state.roundIndex)).toEqual([]);
  });

  it('persists a personal best and marks artifacts as seen', async () => {
    await startGame();
    const playedIds = useGame.getState().rounds.map((artifact) => artifact.id);
    for (let round = 0; round < ROUNDS_PER_SESSION; round++) {
      playRound();
      useGame.getState().nextRound();
    }
    const profile = useGame.getState().profile;
    expect(profile.gamesPlayed).toBe(1);
    expect(profile.bests.expert).toBe(selectTotalScore(useGame.getState()));
    for (const id of playedIds) expect(profile.seen).toContain(id);
  });

  it('does not lower an existing personal best', async () => {
    useGame.setState({
      profile: {
        bests: { expert: 99999 },
        gamesPlayed: 3,
        seen: [],
        daily: null,
        dailyStreak: 0,
        theme: 'system',
      },
    });
    await startGame();
    for (let round = 0; round < ROUNDS_PER_SESSION; round++) {
      playRound({ lat: -40, lon: -170 });
      useGame.getState().nextRound();
    }
    expect(useGame.getState().profile.bests.expert).toBe(99999);
  });

  it('gives the same daily challenge twice in a row', async () => {
    useGame.setState({ pool, phase: 'menu', verifyImage: async (a) => a.image.url });
    await useGame.getState().startSession({ mode: 'daily' });
    const first = useGame.getState().rounds.map((a) => a.id);

    useGame.setState({ phase: 'menu', rounds: [], results: [] });
    await useGame.getState().startSession({ mode: 'daily' });
    expect(useGame.getState().rounds.map((a) => a.id)).toEqual(first);
  });

  it('errors clearly when filters match nothing', async () => {
    useGame.setState({ pool, phase: 'menu', verifyImage: async (a) => a.image.url });
    await useGame
      .getState()
      .startSession({ mode: 'classic', difficulty: 'expert', region: 'oceania' });
    const state = useGame.getState();
    expect(state.phase).toBe('error');
    expect(state.errorMessage).toMatch(/no artifacts match/i);
  });

  it('clears the guess on request', async () => {
    await startGame();
    useGame.getState().setGuess({ lat: 10, lon: 10 });
    useGame.getState().clearGuess();
    expect(useGame.getState().guess).toBeNull();
  });
});

describe('loadPool', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads and validates a bundle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: 1, generatedAt: 'x', sources: [], artifacts: pool }),
      })),
    );
    await useGame.getState().loadPool();
    const state = useGame.getState();
    expect(state.phase).toBe('menu');
    expect(state.pool).toHaveLength(pool.length);
  });

  it('reports an error when the bundle cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    await useGame.getState().loadPool();
    expect(useGame.getState().phase).toBe('error');
    expect(useGame.getState().errorMessage).toContain('503');
  });

  it('reports an error on a network failure rather than hanging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    await useGame.getState().loadPool();
    expect(useGame.getState().phase).toBe('error');
    expect(useGame.getState().errorMessage).toBe('offline');
  });

  it('refuses a bundle too small to play', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          version: 1,
          generatedAt: 'x',
          sources: [],
          artifacts: pool.slice(0, 2),
        }),
      })),
    );
    await useGame.getState().loadPool();
    expect(useGame.getState().phase).toBe('error');
  });
});

describe('broken photographs never become playable rounds', () => {
  /** A verifier that fails for a chosen set of artifact ids. */
  function verifierRejecting(ids: Set<string>) {
    return async (artifact: (typeof pool)[number]) =>
      ids.has(artifact.id) ? null : artifact.image.url;
  }

  beforeEach(() => {
    window.localStorage.clear();
    useGame.setState({
      phase: 'menu',
      errorMessage: null,
      pool,
      rounds: [],
      roundIndex: 0,
      guess: null,
      results: [],
      imageUrls: {},
      unusableArtifactIds: [],
      replacingRound: false,
      viewEpoch: 0,
      profile: {
        bests: {},
        gamesPlayed: 0,
        seen: [],
        daily: null,
        dailyStreak: 0,
        theme: 'system',
      },
      // Reset the filters too: a previous test narrows the region and startSession
      // inherits whatever the patch does not override.
      config: { mode: 'classic', difficulty: 'expert', region: null, era: null },
      verifyImage: async (artifact) => artifact.image.url,
    });
  });

  it('never presents an artifact whose photograph failed', async () => {
    const brokenIds = new Set(pool.slice(0, 40).map((a) => a.id));
    useGame.setState({ verifyImage: verifierRejecting(brokenIds) });
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });

    const state = useGame.getState();
    expect(state.phase).toBe('playing');
    expect(state.rounds).toHaveLength(ROUNDS_PER_SESSION);
    for (const round of state.rounds) {
      expect(brokenIds.has(round.id), `${round.id} was presented despite a dead image`).toBe(false);
      expect(state.imageUrls[round.id]).toBeTruthy();
    }
  });

  it('preserves the session length when candidates are rejected', async () => {
    useGame.setState({
      verifyImage: verifierRejecting(new Set(pool.slice(0, 30).map((a) => a.id))),
    });
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    expect(useGame.getState().rounds).toHaveLength(ROUNDS_PER_SESSION);
  });

  it('remembers rejected artifacts so they are not offered again', async () => {
    const brokenIds = new Set(pool.slice(0, 30).map((a) => a.id));
    useGame.setState({ verifyImage: verifierRejecting(brokenIds) });
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });

    const remembered = useGame.getState().unusableArtifactIds;
    expect(remembered.length).toBeGreaterThan(0);
    for (const id of remembered) expect(brokenIds.has(id)).toBe(true);
  });

  it('reports a recoverable error rather than looping when nothing is usable', async () => {
    useGame.setState({ verifyImage: async () => null });
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });

    const state = useGame.getState();
    expect(state.phase).toBe('error');
    expect(state.errorMessage).toMatch(
      /couldn't find enough artifacts with available photographs/i,
    );
    expect(state.rounds).toHaveLength(0);
  });
});

describe('a photograph that dies after the round is presented', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGame.setState({
      phase: 'menu',
      errorMessage: null,
      pool,
      rounds: [],
      roundIndex: 0,
      guess: null,
      results: [],
      imageUrls: {},
      unusableArtifactIds: [],
      replacingRound: false,
      viewEpoch: 0,
      profile: {
        bests: {},
        gamesPlayed: 0,
        seen: [],
        daily: null,
        dailyStreak: 0,
        theme: 'system',
      },
      // Reset the filters too: a previous test narrows the region and startSession
      // inherits whatever the patch does not override.
      config: { mode: 'classic', difficulty: 'expert', region: null, era: null },
      verifyImage: async (artifact) => artifact.image.url,
    });
  });

  it('swaps in a different artifact rather than allowing a guess without an image', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const original = useGame.getState().rounds[0]!;

    // From now on this artifact has no working rendition at all.
    useGame.setState({
      verifyImage: async (artifact) => (artifact.id === original.id ? null : artifact.image.url),
    });
    await useGame.getState().reportImageFailure(original.id, original.image.url);

    const state = useGame.getState();
    expect(state.phase).toBe('playing');
    expect(state.rounds[0]!.id).not.toBe(original.id);
    expect(state.imageUrls[state.rounds[0]!.id]).toBeTruthy();
    expect(state.unusableArtifactIds).toContain(original.id);
    // Not counted as a completed round.
    expect(state.results).toHaveLength(0);
    expect(state.roundIndex).toBe(0);
    expect(state.rounds).toHaveLength(ROUNDS_PER_SESSION);
  });

  it('prefers another rendition of the same artifact before replacing it', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const original = useGame.getState().rounds[0]!;

    useGame.setState({
      verifyImage: async (artifact) =>
        artifact.id === original.id ? `${artifact.image.url}?alt` : artifact.image.url,
    });
    await useGame.getState().reportImageFailure(original.id, original.image.url);

    const state = useGame.getState();
    // Same artifact, different rendition.
    expect(state.rounds[0]!.id).toBe(original.id);
    expect(state.imageUrls[original.id]).toBe(`${original.image.url}?alt`);
  });

  it('resets the guess so a pin placed for the old artifact cannot be submitted', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const original = useGame.getState().rounds[0]!;
    useGame.getState().setGuess({ lat: 10, lon: 10 });

    useGame.setState({
      verifyImage: async (artifact) => (artifact.id === original.id ? null : artifact.image.url),
    });
    await useGame.getState().reportImageFailure(original.id, original.image.url);

    expect(useGame.getState().guess).toBeNull();
  });

  it('ignores a failure report for an artifact that is no longer current', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const laterRound = useGame.getState().rounds[3]!;
    const before = useGame.getState().rounds.map((a) => a.id);

    await useGame.getState().reportImageFailure(laterRound.id, laterRound.image.url);

    expect(useGame.getState().rounds.map((a) => a.id)).toEqual(before);
  });

  it('leaves a revealed round alone — it is already scored', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const current = useGame.getState().rounds[0]!;
    useGame.getState().setGuess({ lat: 10, lon: 10 });
    useGame.getState().submitGuess();

    await useGame.getState().reportImageFailure(current.id, current.image.url);

    expect(useGame.getState().rounds[0]!.id).toBe(current.id);
    expect(useGame.getState().results).toHaveLength(1);
  });

  it('replaces an upcoming artifact discovered broken by look-ahead', async () => {
    await useGame.getState().startSession({ mode: 'classic', difficulty: 'expert' });
    const upcoming = useGame.getState().rounds[1]!;

    useGame.setState({
      verifyImage: async (artifact) => (artifact.id === upcoming.id ? null : artifact.image.url),
    });
    await useGame.getState().reportUpcomingImageFailure(upcoming.id);

    const state = useGame.getState();
    expect(state.rounds[1]!.id).not.toBe(upcoming.id);
    expect(state.rounds).toHaveLength(ROUNDS_PER_SESSION);
    expect(state.unusableArtifactIds).toContain(upcoming.id);
    // The player is still on round one and unaffected.
    expect(state.roundIndex).toBe(0);
  });
});

describe('daily challenge image verification', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGame.setState({
      phase: 'menu',
      pool,
      rounds: [],
      results: [],
      roundIndex: 0,
      guess: null,
      imageUrls: {},
      unusableArtifactIds: [],
      profile: {
        bests: {},
        gamesPlayed: 0,
        seen: [],
        daily: null,
        dailyStreak: 0,
        theme: 'system',
      },
      // Reset the filters too: a previous test narrows the region and startSession
      // inherits whatever the patch does not override.
      config: { mode: 'classic', difficulty: 'expert', region: null, era: null },
      verifyImage: async (artifact) => artifact.image.url,
    });
  });

  it('gives the same puzzle twice even when some photographs are dead', async () => {
    const broken = new Set(pool.filter((_, index) => index % 3 === 0).map((a) => a.id));
    const verify = async (artifact: (typeof pool)[number]) =>
      broken.has(artifact.id) ? null : artifact.image.url;

    useGame.setState({ verifyImage: verify });
    await useGame.getState().startSession({ mode: 'daily' });
    const first = useGame.getState().rounds.map((a) => a.id);

    useGame.setState({ phase: 'menu', rounds: [], results: [], verifyImage: verify });
    await useGame.getState().startSession({ mode: 'daily' });

    expect(useGame.getState().rounds.map((a) => a.id)).toEqual(first);
    expect(first).toHaveLength(ROUNDS_PER_SESSION);
    for (const id of first) expect(broken.has(id)).toBe(false);
  });

  it("is not influenced by this browser's past image failures", async () => {
    // A player who has hit failures must still get the same daily as everyone else.
    useGame.setState({ unusableArtifactIds: pool.slice(0, 20).map((a) => a.id) });
    await useGame.getState().startSession({ mode: 'daily' });
    const withHistory = useGame.getState().rounds.map((a) => a.id);

    useGame.setState({ phase: 'menu', rounds: [], results: [], unusableArtifactIds: [] });
    await useGame.getState().startSession({ mode: 'daily' });

    expect(useGame.getState().rounds.map((a) => a.id)).toEqual(withHistory);
  });

  it('prefers artifacts the ingest already verified', async () => {
    const verifiedPool = pool.map((artifact, index) =>
      index % 2 === 0
        ? { ...artifact, image: { ...artifact.image, verifiedAt: '2026-08-10T00:00:00.000Z' } }
        : artifact,
    );
    useGame.setState({ pool: verifiedPool });
    await useGame.getState().startSession({ mode: 'daily' });

    for (const round of useGame.getState().rounds) {
      expect(round.image.verifiedAt, `${round.id} was not ingest-verified`).not.toBeNull();
    }
  });
});
