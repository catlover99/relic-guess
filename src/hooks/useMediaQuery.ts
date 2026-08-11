import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * The initial value is read synchronously during the first render so the correct
 * layout is committed immediately — a `useEffect`-only implementation would mount
 * the mobile tree on desktop, tear it down, and take the map instance with it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
