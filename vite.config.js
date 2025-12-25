import { defineConfig } from 'vite';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
  base: '/radiology-ai-viewer/',
  base: '/radiology-ai-viewer/',
  plugins: [viteCommonjs()],
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser']
  },
  worker: { format: 'es' },
  build: {
    outDir: 'docs',
    emptyOutDir: true
  }
});

