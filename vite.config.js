import { defineConfig } from 'vite';

export default defineConfig({
  base: '/radiology-ai-viewer/',
  build: {
    outDir: 'docs',
    emptyOutDir: true
  }
});
