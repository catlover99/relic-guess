import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Compass, Flame, Play, Trophy } from 'lucide-react';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  countEligible,
  type DifficultyId,
} from '@/game/selection';
import { ERAS, type EraId } from '@/game/eras';
import { REGIONS, type RegionId } from '@/game/regions';
import { formatScore, MAX_ROUND_SCORE } from '@/game/scoring';
import { ROUNDS_PER_SESSION, useGame } from '@/game/store';
import { todayKey } from '@/game/random';
import { Button } from '../ui/Button';
import { Panel, SectionTitle } from '../ui/primitives';
import { cn } from '@/lib/cn';
import { warmGameChunks } from '@/app/lazyScreens';

const STEPS = [
  {
    Icon: Compass,
    title: 'Study the object',
    body: 'Shape, material and decoration all point somewhere.',
  },
  {
    Icon: Play,
    title: 'Place your pin',
    body: 'Tap the map, drag to adjust, then lock it in.',
  },
  {
    Icon: Trophy,
    title: 'Learn where it is from',
    body: `Up to ${formatScore(MAX_ROUND_SCORE)} points a round, five rounds a game.`,
  },
] as const;

/**
 * Landing screen.
 *
 * Its job is to get a first-time player into a round in one tap while still
 * exposing the modes. Everything below the primary button is optional, so the
 * fold always contains the pitch, the rules and "Play".
 */
export function StartScreen() {
  const pool = useGame((state) => state.pool);
  const profile = useGame((state) => state.profile);
  const sources = useGame((state) => state.sources);
  const startSession = useGame((state) => state.startSession);

  const [difficulty, setDifficulty] = useState<DifficultyId>(DEFAULT_DIFFICULTY);
  const [region, setRegion] = useState<RegionId | null>(null);
  const [era, setEra] = useState<EraId | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const eligible = useMemo(
    () => countEligible(pool, { difficulty, region, era }),
    [pool, difficulty, region, era],
  );
  // Fetch the round-screen chunk (and Leaflet) while the player reads the rules.
  useEffect(warmGameChunks, []);

  const canStart = eligible >= ROUNDS_PER_SESSION;
  const dailyDone = profile.daily?.date === todayKey();
  const best = profile.bests[difficulty] ?? 0;
  const selectedMode = DIFFICULTIES.find((option) => option.id === difficulty);

  return (
    <main className="strata-bg min-h-dvh pad-safe-x">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-5 px-5 py-6 sm:gap-8 sm:py-10">
        <header className="text-center">
          <p className="font-display text-xs font-semibold tracking-[0.28em] text-brand uppercase">
            Relic
          </p>
          <h1 className="mt-1.5 text-4xl sm:mt-2">Where in the world is it from?</h1>
          <p className="mx-auto mt-2 max-w-xl text-base text-ink-2 sm:mt-3 sm:text-lg">
            You get a photograph of an ancient object. Drop a pin where you think it came from. The
            closer you are, the more you score.
          </p>
        </header>

        {/*
          The rules, as three glanceable steps. Cards on a wide screen; a compact
          icon list on a narrow one, where three stacked cards cost ~180px of
          height and push the primary action below the fold.
        */}
        <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Panel className="flex h-full items-start gap-3 p-3 sm:block sm:p-4">
                <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-soft text-brand sm:mb-2">
                  <step.Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-base">
                    <span className="text-ink-3">{index + 1}. </span>
                    {step.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-2 sm:mt-1">{step.body}</p>
                </div>
              </Panel>
            </li>
          ))}
        </ol>

        <Panel className="p-4 sm:p-5">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
              How hard should it be?
            </legend>
            <div
              className="grid grid-cols-3 gap-1.5 rounded-lg bg-surface-2 p-1"
              role="radiogroup"
              aria-label="Difficulty"
            >
              {DIFFICULTIES.map((option) => {
                const selected = option.id === difficulty;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDifficulty(option.id)}
                    className={cn(
                      'min-h-11 rounded-md px-2 font-display text-base font-semibold transition-colors',
                      selected
                        ? 'bg-surface text-brand shadow-sm ring-1 ring-brand/40'
                        : 'text-ink-2 hover:bg-surface/60',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-ink-2">{selectedMode?.blurb}</p>
            {/* What counts as a right answer, in words a player already knows. */}
            <p className="mt-1 text-sm text-ink-3">{selectedMode?.aim}</p>
          </fieldset>

          <div className="mt-4 space-y-3">
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!canStart}
              onClick={() => void startSession({ mode: 'classic', difficulty, region, era })}
              iconLeft={<Play size={18} aria-hidden />}
            >
              Play {ROUNDS_PER_SESSION} rounds
            </Button>

            <Button
              variant="secondary"
              block
              onClick={() => void startSession({ mode: 'daily' })}
              iconLeft={<CalendarDays size={17} aria-hidden />}
            >
              {dailyDone
                ? `Replay today's challenge (${formatScore(profile.daily?.score ?? 0)})`
                : "Today's challenge"}
            </Button>

            {!canStart && (
              <p role="alert" className="text-sm text-bad">
                Only {eligible} artifacts match these settings — at least {ROUNDS_PER_SESSION} are
                needed. Widen the region or period.
              </p>
            )}
          </div>

          {/* Filters are collapsed by default: they are a power feature and would
              otherwise triple the height of the fold. */}
          <div className="mt-4 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
              className="flex min-h-11 w-full items-center justify-between gap-2 text-sm font-medium text-ink-2"
            >
              <span>
                Narrow it down
                {(region || era) && <span className="ml-1.5 text-brand">· filtered</span>}
              </span>
              <ChevronDown
                size={16}
                aria-hidden
                className={cn('transition-transform', showFilters && 'rotate-180')}
              />
            </button>

            {showFilters && (
              <div className="mt-3 space-y-4">
                <FilterGroup
                  label="Region"
                  options={REGIONS.map((r) => ({ id: r.id, label: r.label, hint: r.blurb }))}
                  value={region}
                  onChange={(value) => setRegion(value as RegionId | null)}
                />
                <FilterGroup
                  label="Period"
                  options={ERAS.map((e) => ({ id: e.id, label: e.label, hint: e.range }))}
                  value={era}
                  onChange={(value) => setEra(value as EraId | null)}
                />
                <p className="tnum text-xs text-ink-3">
                  {eligible} artifacts available with these settings.
                </p>
              </div>
            )}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-sm text-ink-3">
          {best > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Trophy size={14} aria-hidden />
              Best on {DIFFICULTIES.find((d) => d.id === difficulty)?.label}:{' '}
              <strong className="tnum font-semibold text-ink-2">{formatScore(best)}</strong>
            </span>
          )}
          {profile.dailyStreak > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Flame size={14} aria-hidden />
              {profile.dailyStreak}-day streak
            </span>
          )}
          <span className="tnum">{pool.length.toLocaleString()} artifacts in the collection</span>
        </div>

        <footer className="text-center">
          <SectionTitle className="justify-center">Sources</SectionTitle>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Artifact images and data:{' '}
            {sources.length > 0
              ? sources.map((source) => source.name).join(' · ')
              : 'open museum collections'}
            . Ancient place coordinates from the{' '}
            <a
              href="https://pleiades.stoa.org/"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-ink-3/50 underline-offset-2"
            >
              Pleiades
            </a>{' '}
            gazetteer, &copy; the contributors,{' '}
            <a
              href="https://creativecommons.org/licenses/by/3.0/"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-ink-3/50 underline-offset-2"
            >
              CC BY 3.0
            </a>
            . Basemap &copy;{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-ink-3/50 underline-offset-2"
            >
              OpenStreetMap
            </a>{' '}
            contributors. Not affiliated with or endorsed by any museum listed.
          </p>
        </footer>
      </div>
    </main>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string; hint?: string }>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        <FilterChip selected={value === null} onClick={() => onChange(null)}>
          Anywhere
        </FilterChip>
        {options.map((option) => (
          <FilterChip
            key={option.id}
            selected={value === option.id}
            title={option.hint}
            onClick={() => onChange(value === option.id ? null : option.id)}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>
    </fieldset>
  );
}

function FilterChip({
  selected,
  children,
  onClick,
  title,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={title}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full border px-3.5 text-sm transition-colors',
        selected
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
