import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-brand-ink shadow-md hover:bg-brand-hover active:translate-y-px disabled:bg-surface-3 disabled:text-ink-3 disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-line shadow-sm hover:bg-surface-2 active:translate-y-px disabled:text-ink-3',
  ghost: 'bg-transparent text-ink hover:bg-surface-2 disabled:text-ink-3',
  quiet: 'bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:text-ink-3',
  danger: 'bg-bad text-white shadow-md hover:brightness-110 active:translate-y-px',
};

const SIZES: Record<Size, string> = {
  // Every size clears the 44px minimum touch target on its shorter axis.
  sm: 'min-h-11 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-base gap-2',
  lg: 'min-h-13 px-6 text-lg gap-2.5 font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Stretch to the container width — the default for mobile action bars. */
  block?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block,
    iconLeft,
    iconRight,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Defaulting to "button" prevents the accidental form submits that an
      // unspecified type causes.
      type={type ?? 'button'}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg font-medium',
        'transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-80',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
});

/** Square icon-only button. `label` is required — it becomes the accessible name. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'iconLeft' | 'iconRight' | 'block'> & { label: string }
>(function IconButton({ label, className, variant = 'ghost', children, ...rest }, ref) {
  return (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn('aspect-square min-w-11 px-0', className)}
      {...rest}
    >
      {children}
    </Button>
  );
});
