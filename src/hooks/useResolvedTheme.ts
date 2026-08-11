import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { useMediaQuery } from './useMediaQuery';

/**
 * Resolves the "system" theme preference to a concrete value and reflects it onto
 * the document.
 *
 * `data-theme` is only set for an explicit choice: leaving it absent lets the CSS
 * `prefers-color-scheme` block apply, which means the page is already correctly
 * themed before any JavaScript runs.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const preference = useGame((state) => state.profile.theme);
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
  }, [preference]);

  useEffect(() => {
    // Keeps the browser UI (address bar, scrollbars) matched to the page.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0c1211' : '#f6f4ef');
  }, [resolved]);

  return resolved;
}
