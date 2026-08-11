import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Card-like container. `as` lets it become a semantic element where needed. */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface shadow-[var(--shadow-panel)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

type ChipTone = 'neutral' | 'brand' | 'accent' | 'gold' | 'guess' | 'origin';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  brand: 'bg-brand-soft text-brand border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
  gold: 'bg-gold-soft text-gold border-transparent',
  guess: 'bg-guess-soft text-guess border-transparent',
  origin: 'bg-origin-soft text-origin border-transparent',
};

/**
 * Small labelled fact. Used for the pre-guess clues and the reveal facts.
 * `label` is rendered visually but also read as part of the chip, so a screen
 * reader hears "Material: gypsum alabaster" rather than a bare value.
 */
export function Chip({
  label,
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  label?: string;
  children: ReactNode;
  tone?: ChipTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        CHIP_TONES[tone],
        className,
      )}
    >
      {icon}
      {/*
        The label/value distinction is carried by weight and colour rather than by
        an opacity reduction: `opacity-70` on the label dropped it to 3.7:1, which
        fails AA at this size.
      */}
      {label && <span className="font-semibold text-ink-3">{label}</span>}
      <span className="min-w-0 truncate font-medium text-ink">{children}</span>
    </span>
  );
}

/** Definition-list row for the reveal panel. Wraps instead of truncating. */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-0.5 border-b border-line/60 py-2 last:border-0 max-xs:grid-cols-1">
      <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

/** Section heading with an optional trailing slot. */
export function SectionTitle({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{children}</h2>
      {trailing}
    </div>
  );
}
