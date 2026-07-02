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
    port: 5179,
    proxy: {
      '/api': 'http://localhost:8080',
      '/uploads': 'http://localhost:8080',
    }
  }
})
