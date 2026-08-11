/**
 * Tailwind is wired through PostCSS rather than `@tailwindcss/vite`.
 *
 * The Vite plugin loads without error in this environment but never compiles the
 * stylesheet — Vite's own `@import` inlining resolves `@import "tailwindcss"`
 * first, and the output ends up containing Tailwind's raw `@theme default` block
 * with zero generated utilities. The PostCSS integration is unaffected and is an
 * equally supported entry point.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
