import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-time proxy so the React app can call /api/* without hardcoding the
// backend's port, and without CORS getting in the way while developing.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Matches components.json's aliases — shadcn/ui components import
    // each other and lib/utils via "@/...".
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  // Vitest-only config (TASK-046). `vite dev`/`vite build` ignore this key
  // entirely, so this adds a test runner without touching the dev/build
  // pipeline above.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
});
