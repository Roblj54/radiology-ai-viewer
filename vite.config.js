import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Dev at /, build for GitHub Pages at /radiology-ai-viewer/
  base: command === 'build' ? '/radiology-ai-viewer/' : '/',

  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },

  // Critical: only scan the real entry, not docs/, backups/, legacy copies
  optimizeDeps: {
    entries: ['index.html'],
  },

  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
}));
