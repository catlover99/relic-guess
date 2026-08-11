import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

/**
 * Modal dialog built on `<dialog>`.
 *
 * The native element is used deliberately: it provides the top layer, the
 * backdrop, focus containment and Escape-to-close from the platform, which is
 * far more robust than reimplementing a focus trap.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  /** Hide the header chrome for media-only dialogs such as the image viewer. */
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // `close` fires for Escape and for programmatic closes alike, so this keeps
    // React state in step with the element however it was dismissed.
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClick={(event) => {
        // Clicking the backdrop resolves to the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto max-h-[92dvh] w-[min(60rem,94vw)] rounded-xl bg-surface p-0 text-ink',
        'shadow-[var(--shadow-lg)] backdrop:bg-black/55 backdrop:backdrop-blur-sm',
        'open:animate-[dialog-in_var(--duration-base)_var(--ease-out-quint)]',
        className,
      )}
    >
      {!bare && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-xl">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </IconButton>
        </header>
      )}
      {bare && (
        <IconButton
          label="Close"
          onClick={onClose}
          className="absolute top-2 right-2 z-10 bg-surface/85 backdrop-blur-sm"
        >
          <X size={18} aria-hidden />
        </IconButton>
      )}
      {children}
    </dialog>
  );
}
