import { useEffect, useState } from 'react';
import { Loader2, Maximize2 } from 'lucide-react';
import type { Artifact } from '@/data/schema';
import { cn } from '@/lib/cn';
import { Skeleton } from './ui/primitives';
import { altText } from '@/lib/altText';
import { resolveArtifactImage } from '@/game/imageValidation';

/**
 * Artifact photograph.
 *
 * Three problems this solves that the previous `<img>` did not:
 *
 * 1. **Arbitrary aspect ratios.** Museum photography ranges from tall stelae to
 *    wide friezes. The image is centred and contained inside a fixed-ratio well,
 *    so the surrounding layout never reflows when a round changes.
 * 2. **Broken URLs.** Provider CDNs 404 individual files. A dedicated error state
 *    keeps the round playable instead of showing a browser's broken-image icon.
 * 3. **Loading.** A skeleton holds the exact final size, so there is no layout
 *    shift and no flash of empty space on a slow connection.
 */
export function ArtifactImage({
  artifact,
  src,
  className,
  onExpand,
  onUnavailable,
  priority = false,
  nameRevealed = false,
}: {
  artifact: Artifact;
  /**
   * The rendition confirmed loadable for this artifact. Passing it in — rather than
   * reading `artifact.image.url` here — is what guarantees the component can only
   * display a photograph that has already loaded once.
   */
  src: string;
  /** Called when a previously-verified photograph fails in the wild. */
  onUnavailable?: (url: string) => void;
  className?: string;
  /** When provided, the image becomes a button that opens the full-size viewer. */
  onExpand?: () => void;
  priority?: boolean;
  /**
   * Whether the artifact's identity is public yet. Before the guess is locked in
   * it is not, and the alternative text must not name it — "Photograph of the
   * Lamassu of Nimrud" would hand the answer to a screen-reader user that a
   * sighted player has to work out. See `altText`.
   */
  nameRevealed?: boolean;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  // A new artifact must return to the loading state even though the element is
  // reused, otherwise the previous image lingers behind the new one.
  useEffect(() => {
    setStatus('loading');
  }, [src]);

  const alt = altText(artifact, nameRevealed);

  const media = (
    <>
      {status === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}

      {status === 'error' ? (
        /*
         * A transient state, not an outcome the player has to live with.
         *
         * The photograph *is* the round, so a failure here triggers a replacement in
         * the store rather than inviting a guess at an invisible object. This message
         * should almost never be seen: the artifact only reached the screen because
         * its image loaded during preparation.
         */
        <div className="absolute inset-0 grid place-items-center gap-2 p-4 text-center">
          <Loader2 className="mx-auto animate-spin text-ink-3" size={24} aria-hidden />
          <p className="text-sm text-ink-3" role="status">
            That photograph became unavailable.
            <br />
            Finding another artifact…
          </p>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          draggable={false}
          onLoad={() => setStatus('loaded')}
          onError={() => {
            setStatus('error');
            onUnavailable?.(src);
          }}
          className={cn(
            'absolute inset-0 h-full w-full object-contain transition-opacity duration-[var(--duration-base)]',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </>
  );

  const wellClasses = cn(
    'relative isolate overflow-hidden rounded-lg bg-surface-inset',
    // A subtle inner edge reads as a museum vitrine and separates pale objects
    // from a pale background.
    'shadow-[inset_0_0_0_1px_var(--line)]',
    className,
  );

  if (!onExpand) {
    return <div className={wellClasses}>{media}</div>;
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={
        nameRevealed ? `View ${artifact.title} full size` : 'View this artifact full size'
      }
      className={cn(wellClasses, 'group cursor-zoom-in')}
    >
      {media}
      <span
        aria-hidden
        className="absolute right-2 bottom-2 grid h-9 w-9 place-items-center rounded-md bg-surface/90 text-ink-2 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-lg:opacity-100"
      >
        <Maximize2 size={16} />
      </span>
    </button>
  );
}

/**
 * Verifies and decodes the photographs of the rounds just ahead.
 *
 * Two jobs at once: the image is already decoded when "Next artifact" is tapped, so
 * the transition is instant; and a photograph that has died since the session was
 * built is discovered here rather than on the player's screen, giving the store time
 * to swap the artifact silently.
 *
 * The queue is short (see `PREFETCH_WINDOW`) and worked through in order, so a
 * five-round session never pulls five full-resolution photographs at once, and the
 * round the player will actually see next is always warmed first.
 */
export function ImagePrefetch({
  artifacts,
  onUnavailable,
}: {
  artifacts: readonly Artifact[];
  onUnavailable?: (artifact: Artifact) => void;
}) {
  // Depend on the ids rather than the array identity: a re-render that produces an
  // equivalent slice must not restart the queue.
  const key = artifacts.map((artifact) => artifact.id).join(',');

  useEffect(() => {
    if (artifacts.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const artifact of artifacts) {
        if (cancelled) return;
        const url = await resolveArtifactImage(artifact);
        if (cancelled) return;
        if (!url) onUnavailable?.(artifact);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onUnavailable]);
  return null;
}
