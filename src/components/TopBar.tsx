import { Monitor, Moon, Sun } from 'lucide-react';
import { formatScore } from '@/game/scoring';
import { useGame } from '@/game/store';
import { cn } from '@/lib/cn';
import { IconButton } from './ui/Button';

/**
 * Persistent header during a session.
 *
 * Kept to a single row at every viewport: on a 360px phone in landscape there is
 * barely 300px of height to work with, and a two-line header would eat a tenth
 * of it.
 */
export function TopBar({
  roundNumber,
  totalRounds,
  totalScore,
  results,
  onExit,
}: {
  roundNumber: number;
  totalRounds: number;
  totalScore: number;
  /** Score per completed round, for the progress pips. */
  results: number[];
  onExit: () => void;
}) {
  return (
    <header className="pad-safe-top pad-safe-x z-20 shrink-0 border-b border-line bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex h-[var(--size-topbar)] max-w-[110rem] items-center gap-3 px-3 sm:px-4">
        <button
          type="button"
          onClick={onExit}
          aria-label="Leave this game and return to the menu"
          className="-mx-1 inline-flex min-h-11 shrink-0 items-center px-1 font-display text-sm font-semibold tracking-[0.16em] text-brand uppercase"
        >
          Relic
        </button>

        <div className="mx-auto flex min-w-0 shrink items-center gap-2">
          <p className="tnum shrink-0 text-sm font-medium whitespace-nowrap text-ink-2">
            {/* "Round" is dropped below 428px, where the full label wraps onto a
                second line and stretches the bar. */}
            <span className="max-xs:hidden">Round </span>
            <span className="font-semibold text-ink">{roundNumber}</span>
            <span className="text-ink-3">/{totalRounds}</span>
          </p>
          {/* Pips double as a progress bar and a per-round score summary; the
              accessible list below carries the same information as text. */}
          <ol className="flex shrink-0 items-center gap-1" aria-hidden>
            {Array.from({ length: totalRounds }, (_, index) => {
              const score = results[index];
              const isCurrent = index === roundNumber - 1;
              return (
                <li
                  key={index}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    score != null
                      ? 'w-5 bg-gold'
                      : isCurrent
                        ? 'w-5 bg-brand'
                        : 'w-1.5 bg-surface-3',
                  )}
                />
              );
            })}
          </ol>
        </div>

        <p className="tnum shrink-0 text-right text-sm whitespace-nowrap">
          <span className="sr-only">Total score: </span>
          <span className="font-display text-lg font-semibold text-gold">
            {formatScore(totalScore)}
          </span>
        </p>

        <ThemeToggle />
      </div>
    </header>
  );
}

const THEME_ORDER = ['system', 'light', 'dark'] as const;
const THEME_META = {
  system: { icon: Monitor, label: 'Theme: follow system. Switch to light.' },
  light: { icon: Sun, label: 'Theme: light. Switch to dark.' },
  dark: { icon: Moon, label: 'Theme: dark. Switch to system.' },
} as const;

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useGame((state) => state.profile.theme);
  const setTheme = useGame((state) => state.setTheme);
  const { icon: Icon, label } = THEME_META[theme];

  return (
    <IconButton
      label={label}
      className={className}
      onClick={() => {
        const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
        setTheme(next);
      }}
    >
      <Icon size={17} aria-hidden />
    </IconButton>
  );
}
