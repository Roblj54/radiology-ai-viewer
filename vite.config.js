import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    outDir: 'docs',
    emptyOutDir: true
  }
});
