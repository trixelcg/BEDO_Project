import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Suppress the chunk size warning — large 3D libs are expected
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // No proxy: BEDO-003 removed the last API route, so the dev server has nothing to
    // forward and `npm run dev` no longer starts a backend alongside it.
    port: 5179,
  }
})
