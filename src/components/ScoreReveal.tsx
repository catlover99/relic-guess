import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Compass, Target } from 'lucide-react';
import { compassDirection, formatDistance } from '@/game/geo';
import { formatScore, MAX_ROUND_SCORE, scoreBand, type ScoreBreakdown } from '@/game/scoring';
import type { GeoPoint, OriginPlace } from '@/data/schema';
import { cn } from '@/lib/cn';

/**
 * Counts up to `value`. Score feedback that lands instantly reads as a number;
 * score feedback that climbs reads as a result, which is the point of the reveal.
 * Skipped entirely under `prefers-reduced-motion`.
 */
function useCountUp(value: number, durationMs = 850): number {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast at first, settling into the final number.
      setDisplay(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduceMotion]);

  return display;
}

export function ScoreReveal({
  breakdown,
  guess,
  origin,
  className,
}: {
  breakdown: ScoreBreakdown;
  guess: GeoPoint;
  origin: OriginPlace;
  className?: string;
}) {
  const animated = useCountUp(breakdown.score);
  const band = scoreBand(breakdown.score);
  const direction = compassDirection(guess, origin);
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn('space-y-3', className)}>
      {/* Announced as one sentence so a screen reader gets the outcome in a
          single utterance rather than five disconnected numbers. */}
      <p className="sr-only" role="status">
        {band.label}. {formatScore(breakdown.score)} of {MAX_ROUND_SCORE} points. Your guess was{' '}
        {formatDistance(breakdown.distanceKm)} {direction} of {origin.label}.
      </p>

      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div>
          <p className="font-display text-xs font-semibold tracking-[0.1em] text-ink-3 uppercase">
            {band.label}
          </p>
          <p className="tnum font-display text-4xl leading-none font-semibold text-gold">
            {formatScore(animated)}
            <span className="ml-1 text-lg font-normal text-ink-3">
              / {formatScore(MAX_ROUND_SCORE)}
            </span>
          </p>
        </div>
        <dl className="ml-auto text-right">
          {/* The compass icon lives with the label rather than the value: beside a
              four-digit distance it pushed the bearing letter to the screen edge on
              a 390px viewport. */}
          <dt className="flex items-center justify-end gap-1 text-2xs font-semibold tracking-wider text-ink-3 uppercase">
            <Compass size={11} aria-hidden />
            Off by
          </dt>
          <dd className="tnum text-xl font-semibold whitespace-nowrap">
            {formatDistance(breakdown.distanceKm)}{' '}
            <span className="text-sm font-medium text-ink-3">{direction}</span>
          </dd>
        </dl>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={breakdown.score}
        aria-valuemin={0}
        aria-valuemax={MAX_ROUND_SCORE}
        aria-label="Round score"
      >
        <motion.div
          className="h-full rounded-full bg-gold"
          initial={{ width: reduceMotion ? `${breakdown.fraction * 100}%` : 0 }}
          animate={{ width: `${breakdown.fraction * 100}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Only shown when the source coordinate is imprecise enough for the
          tolerance to have mattered — otherwise it is noise. */}
      {breakdown.toleranceKm > 0 && breakdown.distanceKm > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-ink-3">
          <Target size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            This origin is recorded only to about {formatDistance(breakdown.toleranceKm)}, so that
            much of the distance was not counted against you.
          </span>
        </p>
      )}
    </div>
  );
}
