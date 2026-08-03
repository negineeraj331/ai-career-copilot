// `vitest/config`'s defineConfig, not `vite`'s: only this one accepts the
// `test` key. Vite 8's own defineConfig rejects it outright.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 55173, not 5173: another local project already listens on 5173 — and
    // only on IPv6, so an IPv4-only probe reports it free. Same 5xxxx block as
    // the API and datastores.
    port: 55173,
    // Fail loudly instead of silently sliding to 5174 — a moved port means the
    // API's CORS allowlist no longer matches and every request fails with a
    // confusing browser error rather than an obvious one.
    strictPort: true,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app chunk so a
        // code change does not invalidate them in every user's cache.
        //
        // The function form, not the `{name: [...]}` record: Vite 8 types
        // `manualChunks` as a function only, and matching on module id also
        // catches transitive dependencies the record form would miss.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|react-router)/.test(id)) return 'react';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('framer-motion') || id.includes('motion-dom')) return 'motion';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
