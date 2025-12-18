import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: './',
  worker: { format: 'es' },
  build: {
    outDir: '../docs',
    emptyOutDir: true
  }
});
