import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, ChevronUp, MapPin, RotateCcw } from 'lucide-react';
import type { Artifact } from '@/data/schema';
import { ROUNDS_PER_SESSION } from '@/game/store';
import {
  selectCurrentArtifact,
  selectCurrentResult,
  selectIsLastRound,
  upcomingArtifacts,
  selectTotalScore,
  useGame,
} from '@/game/store';
import { cn } from '@/lib/cn';
import { GameMap } from '../map/GameMap';
import { ArtifactImage, ImagePrefetch } from '../ArtifactImage';
import { altText } from '@/lib/altText';
import { ClueList } from '../ClueList';
import { RevealPanel } from '../RevealPanel';
import { TopBar } from '../TopBar';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SectionTitle } from '../ui/primitives';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * The round screen.
 *
 * Two intentionally different layouts share one component tree so state and the
 * map instance are never duplicated:
 *
 * - **Split** (≥1024px wide, or ≥640px wide and ≤544px tall) — a two-column
 *   layout. The artifact panel owns a column and scrolls internally; the map takes
 *   all remaining space and nothing overlaps it. The short-and-wide case catches
 *   phones in landscape, where stacking would leave the map roughly 50px tall.
 * - **Stacked** (everything else) — a vertical flex column: header, collapsible
 *   artifact card, map, action bar. Because it is a flex column rather than a set
 *   of absolute overlays, the map is never covered, the action button is always
 *   reachable, and collapsing the card genuinely gives its height to the map.
 *
 * Both are sized in `dvh`, so a mobile browser's collapsing toolbar resizes the
 * map instead of pushing the primary button off-screen.
 */
export function RoundScreen() {
  const phase = useGame((state) => state.phase);
  const artifact = useGame(selectCurrentArtifact);
  const result = useGame(selectCurrentResult);
  const guess = useGame((state) => state.guess);
  const roundIndex = useGame((state) => state.roundIndex);
  const rounds = useGame((state) => state.rounds);
  const results = useGame((state) => state.results);
  const totalScore = useGame(selectTotalScore);
  const isLastRound = useGame(selectIsLastRound);
  const difficulty = useGame((state) => state.config.difficulty);
  /*
   * Computed here rather than in a selector: a selector returning a fresh array would
   * make this component re-render on every store update, including each score tick.
   */
  const upcoming = useMemo(() => upcomingArtifacts(rounds, roundIndex), [rounds, roundIndex]);
  const viewEpoch = useGame((state) => state.viewEpoch);
  const imageUrls = useGame((state) => state.imageUrls);
  const replacingRound = useGame((state) => state.replacingRound);
  const reportImageFailure = useGame((state) => state.reportImageFailure);
  const reportUpcomingImageFailure = useGame((state) => state.reportUpcomingImageFailure);

  const setGuess = useGame((state) => state.setGuess);
  const clearGuess = useGame((state) => state.clearGuess);
  const submitGuess = useGame((state) => state.submitGuess);
  const nextRound = useGame((state) => state.nextRound);
  const openMenu = useGame((state) => state.openMenu);

  const theme = useResolvedTheme();
  /*
   * The split layout is chosen by available *area*, not width alone. A phone in
   * landscape (844×390) is below the 1024px breakpoint but stacking on it leaves
   * the map about 50px tall — so any viewport that is wide and short gets the
   * side-by-side treatment too.
   */
  const isSplit = useMediaQuery('(min-width: 64rem), (min-width: 40rem) and (max-height: 34rem)');
  const reduceMotion = useReducedMotion();

  const [cardOpen, setCardOpen] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const revealed = phase === 'revealed';

  /*
   * Render only from the store's verified map. Falling back to
   * `artifact.image.url` would reintroduce the possibility of showing a rendition
   * that was never confirmed loadable.
   */
  const imageSrc = artifact ? (imageUrls[artifact.id] ?? '') : '';

  const handleUpcomingUnavailable = useCallback(
    (upcoming: Artifact) => {
      void reportUpcomingImageFailure(upcoming.id);
    },
    [reportUpcomingImageFailure],
  );

  const handleImageUnavailable = useCallback(
    (url: string) => {
      if (artifact) void reportImageFailure(artifact.id, url);
    },
    [artifact, reportImageFailure],
  );

  /*
   * Insets for `fitBounds`. The bottom needs the most room: a marker is 52px tall,
   * and beneath it sit Leaflet's attribution strip and — in the stacked layout —
   * the action bar. Without this the revealed origin lands half under the "Next
   * artifact" button.
   *
   * Memoised because it is a dependency of the map's reveal effect: a fresh object
   * each render would re-run that effect every time, tearing down and re-adding the
   * markers and re-fitting the bounds on every unrelated state change.
   */
  const mapPadding = useMemo(
    () =>
      isSplit
        ? { top: 24, right: 24, bottom: 40, left: 24 }
        : { top: 16, right: 16, bottom: 76, left: 16 },
    [isSplit],
  );

  // A new round starts with the artifact visible again, however the player left
  // the previous one.
  useEffect(() => {
    if (!revealed) setCardOpen(true);
  }, [roundIndex, revealed]);

  // On reveal, expand the panel so the answer is not hidden behind a chevron, and
  // move focus to the results so keyboard and screen-reader users land on the
  // outcome rather than staying on a now-disabled button.
  useEffect(() => {
    if (!revealed) return;
    setCardOpen(true);
    // `preventScroll` matters: focusing normally scrolls the artifact photograph
    // out of the panel just as the player wants to compare it with the answer.
    revealRef.current?.focus({ preventScroll: true });
  }, [revealed]);

  const handleSubmit = useCallback(() => {
    submitGuess();
  }, [submitGuess]);

  // Enter advances the game from anywhere that is not a control, which makes a
  // five-round session playable almost entirely from the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('button, a, input, dialog') || target.role === 'application'))
        return;
      if (revealed) nextRound();
      else if (guess) handleSubmit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revealed, guess, nextRound, handleSubmit]);

  if (!artifact) return null;

  const primaryAction = revealed ? (
    <Button
      ref={primaryRef}
      variant="primary"
      size="lg"
      block
      onClick={nextRound}
      iconRight={<ArrowRight size={18} aria-hidden />}
    >
      {isLastRound ? 'See your results' : 'Next artifact'}
    </Button>
  ) : (
    <Button
      ref={primaryRef}
      variant="primary"
      size="lg"
      block
      disabled={!guess || replacingRound}
      onClick={handleSubmit}
      iconLeft={<Check size={18} aria-hidden />}
    >
      {replacingRound
        ? 'Finding another artifact…'
        : guess
          ? 'Lock in guess'
          : 'Tap the map to place a pin'}
    </Button>
  );

  const secondaryAction = !revealed && guess && (
    <Button variant="quiet" onClick={clearGuess} iconLeft={<RotateCcw size={15} aria-hidden />}>
      <span className="max-xs:sr-only">Clear pin</span>
    </Button>
  );

  const map = (
    <GameMap
      guess={guess}
      onGuessChange={setGuess}
      origin={revealed && result ? result.artifact.origin : null}
      locked={revealed}
      theme={theme}
      resetKey={viewEpoch}
      padding={mapPadding}
    />
  );

  const revealBody = result && (
    <div
      ref={revealRef}
      tabIndex={-1}
      // Focused programmatically on reveal; `-1` keeps it out of the tab order.
      className="outline-none"
    >
      <RevealPanel result={result} />
    </div>
  );

  /* ---------------- Split: two columns ---------------- */
  if (isSplit) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden" data-artifact-id={artifact.id}>
        <TopBar
          roundNumber={roundIndex + 1}
          totalRounds={rounds.length || ROUNDS_PER_SESSION}
          totalScore={totalScore}
          results={results.map((r) => r.breakdown.score)}
          onExit={openMenu}
        />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,34%)_1fr] lg:grid-cols-[var(--width-panel)_1fr] xl:grid-cols-[var(--width-panel-wide)_1fr]">
          {/*
            The action row sits *outside* the scrollable region. Inside it, a long
            reveal (description plus eight fact rows) scrolls "Next artifact" off
            the bottom of the screen, and the player has to hunt for the way
            forward at the end of every round.
          */}
          <aside
            aria-label={revealed ? 'Round result' : 'Artifact to identify'}
            className="flex min-h-0 flex-col border-r border-line bg-surface"
          >
            <div className="scroll-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
              <ArtifactImage
                artifact={artifact}
                src={imageSrc}
                onExpand={() => setViewerOpen(true)}
                onUnavailable={handleImageUnavailable}
                priority
                nameRevealed={revealed}
                className="aspect-4/3 max-h-[38dvh] w-full shrink-0"
              />

              {revealed ? (
                revealBody
              ) : (
                <div className="space-y-3">
                  <SectionTitle>What you know</SectionTitle>
                  <ClueList
                    artifact={artifact}
                    difficulty={difficulty}
                    className="flex flex-wrap gap-1.5"
                  />
                  <p className="text-sm text-ink-2">
                    Place your pin where you think this object came from. You can drag it until you
                    lock it in.
                  </p>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
              {secondaryAction}
              <div className="flex-1">{primaryAction}</div>
            </div>
          </aside>

          <main className="relative min-h-0" aria-label="Map">
            {map}
            <GuessHint visible={!revealed && !guess} />
          </main>
        </div>

        <ImagePrefetch artifacts={upcoming} onUnavailable={handleUpcomingUnavailable} />
        <ImageViewer
          artifact={artifact}
          src={imageSrc}
          nameRevealed={revealed}
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />
      </div>
    );
  }

  /* ---------------- Stacked: vertical column ---------------- */
  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-artifact-id={artifact.id}>
      <TopBar
        roundNumber={roundIndex + 1}
        totalRounds={rounds.length || ROUNDS_PER_SESSION}
        totalScore={totalScore}
        results={results.map((r) => r.breakdown.score)}
        onExit={openMenu}
      />

      {/* Collapsible artifact / reveal card. `max-h` rather than `h` so short
          content does not leave dead space, and the map always gets the rest. */}
      <AnimatePresence initial={false}>
        {cardOpen && (
          <motion.section
            key="card"
            aria-label={revealed ? 'Round result' : 'Artifact to identify'}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="pad-safe-x shrink-0 overflow-hidden border-b border-line bg-surface"
          >
            <div
              className={cn(
                'scroll-panel px-3 pt-3 pb-2',
                // The reveal needs room to read; while guessing the image should
                // not crowd out the map.
                revealed ? 'max-h-[min(52dvh,26rem)]' : 'max-h-[min(46dvh,15rem)]',
              )}
            >
              <div className={cn('flex gap-3', revealed && 'flex-col')}>
                <ArtifactImage
                  artifact={artifact}
                  src={imageSrc}
                  onExpand={() => setViewerOpen(true)}
                  onUnavailable={handleImageUnavailable}
                  priority
                  nameRevealed={revealed}
                  className={cn(
                    'shrink-0',
                    revealed ? 'aspect-16/9 w-full' : 'aspect-square w-[38%] max-w-40 min-w-28',
                  )}
                />
                {revealed ? (
                  revealBody
                ) : (
                  <div className="min-w-0 flex-1 space-y-2">
                    <ClueList
                      artifact={artifact}
                      difficulty={difficulty}
                      className="flex flex-wrap gap-1.5"
                    />
                    <p className="text-xs text-ink-3">Tap the image to see it full size.</p>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setCardOpen((open) => !open)}
        aria-expanded={cardOpen}
        className="pad-safe-x flex min-h-11 shrink-0 items-center justify-center gap-1.5 border-b border-line bg-surface-2 text-xs font-medium text-ink-2"
      >
        {cardOpen ? (
          <>
            <ChevronUp size={14} aria-hidden />
            {revealed ? 'Hide result' : 'Hide artifact'} — more map
          </>
        ) : (
          <>
            <ChevronDown size={14} aria-hidden />
            {revealed ? 'Show result' : 'Show artifact'}
          </>
        )}
      </button>

      <main className="relative min-h-0 flex-1" aria-label="Map">
        {map}
        <GuessHint visible={!revealed && !guess} />
      </main>

      <div className="pad-safe-bottom pad-safe-x shrink-0 border-t border-line bg-surface">
        <div className="flex items-center gap-2 p-3">
          {secondaryAction}
          <div className="flex-1">{primaryAction}</div>
        </div>
      </div>

      <ImagePrefetch artifacts={upcoming} onUnavailable={handleUpcomingUnavailable} />
      <ImageViewer
        artifact={artifact}
        src={imageSrc}
        nameRevealed={revealed}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </div>
  );
}

/**
 * First-guess affordance. Sits above the map but is `pointer-events-none`, so it
 * can never swallow the tap it is asking for.
 */
function GuessHint({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/85 px-3 py-1.5 text-xs font-medium text-ink-inverse shadow-md backdrop-blur-sm"
        >
          <MapPin size={13} aria-hidden />
          Tap the map to place your pin
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Full-size photograph, for inspecting detail before guessing. */
function ImageViewer({
  artifact,
  src,
  nameRevealed,
  open,
  onClose,
}: {
  artifact: Artifact;
  src: string;
  nameRevealed: boolean;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      // The dialog's accessible name must not identify the object before the
      // reveal, for the same reason the image's alt text must not.
      title={nameRevealed ? artifact.title : 'Artifact photograph'}
      bare
      className="w-[min(96vw,80rem)]"
    >
      <div className="grid max-h-[92dvh] place-items-center overflow-auto bg-surface-inset p-2">
        <img
          src={src}
          alt={altText(artifact, nameRevealed)}
          className="max-h-[86dvh] w-auto max-w-full object-contain"
        />
      </div>
      <p className="border-t border-line px-3 py-2 text-2xs text-ink-3">
        {artifact.image.attribution} — {artifact.image.license}
      </p>
    </Dialog>
  );
}
