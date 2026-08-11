import { lazy } from 'react';

/**
 * Screens are split out of the entry bundle.
 *
 * The landing page needs neither Leaflet (~150 KB) nor the reveal machinery, and
 * the first thing a visitor waits for is the landing page plus the artifact
 * bundle. Splitting cuts what must parse before the game is interactive.
 *
 * The import promises are exported alongside the components so the landing screen
 * can warm them while the player is still choosing a difficulty — by the time
 * "Play" is tapped the chunk is already there, and the lazy boundary never
 * actually shows a fallback.
 */
const roundScreenImport = () => import('@/components/screens/RoundScreen');
const summaryScreenImport = () => import('@/components/screens/SummaryScreen');

export const RoundScreen = lazy(async () => ({
  default: (await roundScreenImport()).RoundScreen,
}));

export const SummaryScreen = lazy(async () => ({
  default: (await summaryScreenImport()).SummaryScreen,
}));

let warmed = false;

/** Idempotent, and safe to call from an effect on every render. */
export function warmGameChunks(): void {
  if (warmed) return;
  warmed = true;
  void roundScreenImport();
  void summaryScreenImport();
}
