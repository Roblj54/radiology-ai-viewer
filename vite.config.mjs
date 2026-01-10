import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/radiology-ai-viewer/',
  plugins: [react()],
})