import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    /*
     * File watching on a mounted Windows filesystem (`/mnt/c/...` under WSL2) gets
     * no inotify events, so Vite never learns a file changed: HMR silently does
     * nothing and the dev server keeps serving its cached transform of the *old*
     * module. That is indistinguishable from "my fix didn't work" — it costs real
     * debugging time, so polling is on by default here.
     *
     * Set VITE_NO_POLLING=1 on a native Linux/macOS checkout to get the cheaper
     * event-based watcher back.
     */
    watch: process.env.VITE_NO_POLLING
      ? undefined
      : {
          usePolling: true,
          interval: 1000,
          // Polling must be scoped or it starves the transform pipeline: the
          // generated artifact bundle alone is several megabytes, and stat-ing
          // node_modules on this filesystem costs more than the watch is worth.
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/.cache/**',
            '**/dist/**',
            '**/test-results/**',
            '**/playwright-report/**',
            '**/public/data/**',
          ],
        },
  },

  build: {
    target: 'es2022',
    // Chunking is driven by the dynamic imports in src/app/lazyScreens.ts rather
    // than a manualChunks map: the split that matters is landing page vs. game,
    // and letting Rollup follow the real import graph keeps Leaflet and
    // framer-motion out of the entry chunk without hand-maintained lists.
  },
});
