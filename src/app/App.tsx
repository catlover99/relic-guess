import { Suspense, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useGame } from '@/game/store';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { StartScreen } from '@/components/screens/StartScreen';
import { RoundScreen, SummaryScreen } from './lazyScreens';
import { Button } from '@/components/ui/Button';
import { Panel, Skeleton } from '@/components/ui/primitives';

export default function App() {
  const phase = useGame((state) => state.phase);
  const loadPool = useGame((state) => state.loadPool);
  const poolLoaded = useGame((state) => state.pool.length > 0);

  // Applies the theme to <html> for every screen, including the loader.
  useResolvedTheme();

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div id="main">
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'preparing' && <PreparingScreen />}
        {phase === 'error' && <ErrorScreen canRetry={!poolLoaded} />}
        {phase === 'menu' && <StartScreen />}
        <Suspense fallback={<LoadingScreen />}>
          {(phase === 'playing' || phase === 'revealed') && <RoundScreen />}
          {phase === 'summary' && <SummaryScreen />}
        </Suspense>
      </div>
      <Analytics />
    </>
  );
}

/**
 * Loading state.
 *
 * Deliberately a skeleton of the landing page rather than a bare spinner: the
 * bundle is a couple of megabytes of JSON, and showing the shape of what is coming
 * makes the wait feel shorter and prevents a layout jump when it arrives.
 */
function LoadingScreen() {
  return (
    <main className="strata-bg min-h-dvh" aria-busy="true">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-5 py-10">
        <div className="space-y-3 text-center">
          <p className="font-display text-xs font-semibold tracking-[0.28em] text-brand uppercase">
            Relic
          </p>
          <Skeleton className="mx-auto h-10 w-[min(30rem,90%)]" />
          <Skeleton className="mx-auto h-5 w-[min(24rem,80%)]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-48" />
        <p className="flex items-center justify-center gap-2 text-sm text-ink-3" role="status">
          <Loader2 className="animate-spin" size={15} aria-hidden />
          Unpacking the collection…
        </p>
      </div>
    </main>
  );
}

/**
 * Shown while a session is being assembled.
 *
 * Assembling means verifying that each candidate's photograph actually loads, which
 * takes a moment on a cold cache. It is a distinct state from `loading` — the
 * collection is already here — so the copy says what is actually happening.
 */
function PreparingScreen() {
  return (
    <main className="strata-bg grid min-h-dvh place-items-center px-5 py-10" aria-busy="true">
      <div className="text-center">
        <p className="font-display text-xs font-semibold tracking-[0.28em] text-brand uppercase">
          Relic
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-ink-2" role="status">
          <Loader2 className="animate-spin" size={15} aria-hidden />
          Checking photographs…
        </p>
      </div>
    </main>
  );
}

/**
 * Error state.
 *
 * Two distinct cases: the collection never loaded (retry is the only useful
 * action) and a filter combination produced no rounds (going back to the menu is).
 */
function ErrorScreen({ canRetry }: { canRetry: boolean }) {
  const message = useGame((state) => state.errorMessage);
  const loadPool = useGame((state) => state.loadPool);
  const openMenu = useGame((state) => state.openMenu);

  return (
    <main className="strata-bg grid min-h-dvh place-items-center px-5 py-10">
      <Panel className="max-w-md p-6 text-center">
        <span className="mx-auto mb-3 inline-grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <h1 className="text-2xl">Something went wrong</h1>
        <p role="alert" className="mt-2 text-sm text-ink-2">
          {message ?? 'The artifact collection could not be loaded.'}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {canRetry ? (
            <Button
              variant="primary"
              size="lg"
              block
              onClick={() => void loadPool()}
              iconLeft={<RefreshCw size={17} aria-hidden />}
            >
              Try again
            </Button>
          ) : (
            <Button variant="primary" size="lg" block onClick={openMenu}>
              Back to the menu
            </Button>
          )}
        </div>
      </Panel>
    </main>
  );
}
