import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

// Frontend app version, sourced from package.json's own `version` field
// (the single place this repo already tracks it) and baked into the
// bundle at build time — see JobOptionsModal.tsx, which displays this
// alongside the backend's own /health-reported version.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      // JobOptionsModal.tsx's apiClient.getHealth() fetches this in dev
      // too — without proxying it, the request hits Vite's own dev
      // server (which 404s), getHealth()'s .catch() swallows the error,
      // and the backend version silently stays stuck on its "…"
      // placeholder forever instead of resolving.
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
