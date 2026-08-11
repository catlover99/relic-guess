import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * Testing Library auto-cleans only when Vitest's globals are enabled, which they
 * are not here. Without this, rendered trees accumulate across tests and every
 * `getByText` starts matching several elements at once.
 */
afterEach(cleanup);

/**
 * jsdom implements neither `matchMedia` nor `ResizeObserver`, both of which the
 * responsive layout and the map depend on. Stubbing them here rather than in each
 * test keeps the components free of test-only branches.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
