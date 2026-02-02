import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/radiology-ai-viewer/',
to read about a specific subcommand or concept.
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false }
})