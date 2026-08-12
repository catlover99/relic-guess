import { useState } from 'react';
import { Check, Copy, Home, RotateCcw, Trophy } from 'lucide-react';
import { formatDistance } from '@/game/geo';
import { formatScore, MAX_ROUND_SCORE, scoreBand, sessionRank } from '@/game/scoring';
import { DIFFICULTIES } from '@/game/selection';
import { buildShareText } from '@/game/share';
import { dailyNumber } from '@/game/random';
import { useGame, type RoundResult } from '@/game/store';
import { Button } from '../ui/Button';
import { Panel, SectionTitle } from '../ui/primitives';
import { ThemeToggle } from '../TopBar';
import { cn } from '@/lib/cn';

/** End-of-session review: the score, then every round as a reviewable row. */
export function SummaryScreen() {
  const results = useGame((state) => state.results);
  const config = useGame((state) => state.config);
  const profile = useGame((state) => state.profile);
  const startSession = useGame((state) => state.startSession);
  const openMenu = useGame((state) => state.openMenu);

  const total = results.reduce((sum, result) => sum + result.breakdown.score, 0);
  const possible = results.length * MAX_ROUND_SCORE;
  const rank = sessionRank(total, results.length);
  const best = profile.bests[config.difficulty] ?? 0;
  const isNewBest = total >= best && total > 0;
  const difficultyLabel =
    DIFFICULTIES.find((d) => d.id === config.difficulty)?.label ?? config.difficulty;

  return (
    <main className="strata-bg min-h-dvh pad-safe-x pad-safe-bottom">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-sm font-semibold tracking-[0.16em] text-brand uppercase">
            Relic
          </p>
          <ThemeToggle />
        </div>

        <Panel className="overflow-hidden">
          <header className="border-b border-line bg-brand-soft px-5 py-6 text-center">
            <p className="text-xs font-semibold tracking-[0.1em] text-brand uppercase">
              {config.mode === 'daily'
                ? `Daily #${dailyNumber()}`
                : `${difficultyLabel} · complete`}
            </p>
            <p className="tnum font-display text-4xl leading-none font-semibold text-ink">
              {formatScore(total)}
              <span className="ml-1 text-xl font-normal text-ink-3">/ {formatScore(possible)}</span>
            </p>
            <p className="mt-2 font-display text-lg text-brand">{rank.label}</p>

            {isNewBest && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1 text-xs font-semibold text-gold">
                <Trophy size={13} aria-hidden />
                New personal best
              </p>
            )}
            {!isNewBest && best > 0 && (
              <p className="tnum mt-2 text-xs text-ink-3">
                Your best on {difficultyLabel}: {formatScore(best)}
              </p>
            )}
          </header>

          <div className="p-4">
            <SectionTitle className="mb-2">Round by round</SectionTitle>
            <ol className="space-y-2">
              {results.map((result, index) => (
                <RoundRow key={result.artifact.id} result={result} index={index} />
              ))}
            </ol>
          </div>

          <div className="space-y-2 border-t border-line p-4">
            <Button
              variant="primary"
              size="lg"
              block
              onClick={() => void startSession({ mode: 'classic' })}
              iconLeft={<RotateCcw size={17} aria-hidden />}
            >
              Play again
            </Button>
            <div className="flex gap-2">
              <ShareButton results={results} mode={config.mode} modeLabel={difficultyLabel} />
              <Button block onClick={openMenu} iconLeft={<Home size={16} aria-hidden />}>
                Change settings
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function RoundRow({ result, index }: { result: RoundResult; index: number }) {
  const { artifact, breakdown } = result;
  const band = scoreBand(breakdown.score);

  return (
    <li>
      <a
        href={artifact.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2 transition-colors hover:bg-surface-2"
      >
        <img
          src={artifact.image.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-14 w-14 shrink-0 rounded-md bg-surface-inset object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            <span className="text-ink-3">{index + 1}. </span>
            {artifact.title}
          </p>
          <p className="truncate text-xs text-ink-2">{artifact.origin.label}</p>
          <p className="tnum text-xs text-ink-3">
            {formatDistance(breakdown.distanceKm)} away · {band.label}
          </p>
        </div>
        <p
          className={cn(
            'tnum shrink-0 font-display text-lg font-semibold',
            breakdown.score > 0 ? 'text-gold' : 'text-ink-3',
          )}
        >
          {formatScore(breakdown.score)}
        </p>
      </a>
    </li>
  );
}

/**
 * Copies a spoiler-free result summary.
 *
 * The text itself is built in `game/share.ts` so its exact shape is testable;
 * this component only owns the clipboard interaction, including the textarea
 * fallback for browsers where the async clipboard API is unavailable or blocked.
 */
function ShareButton({
  results,
  mode,
  modeLabel,
}: {
  results: RoundResult[];
  mode: 'classic' | 'daily';
  modeLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const text = buildShareText({
    scores: results.map((result) => result.breakdown.score),
    dailyNumber: mode === 'daily' ? dailyNumber() : undefined,
    modeLabel,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      block
      onClick={copy}
      iconLeft={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
    >
      {copied ? 'Copied' : 'Share result'}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Result copied to clipboard' : ''}
      </span>
    </Button>
  );
}
