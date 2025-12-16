import { defineConfig } from 'vite';

export default defineConfig({
  base: '/radiology-ai-viewer/',
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true
  }
});
