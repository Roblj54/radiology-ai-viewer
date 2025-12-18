import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: '/radiology-ai-viewer/',
  worker: { format: 'es' },
  build: {
    outDir: '../docs',
    emptyOutDir: true
  }
});
