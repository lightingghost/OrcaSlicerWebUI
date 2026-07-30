import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// __APP_VERSION__ is normally injected by vite.config.ts's `define`
// block from package.json (see that file's comment) — tests run through
// this separate vitest config instead, so it needs its own definition or
// any component referencing __APP_VERSION__ (JobOptionsModal.tsx) throws
// "__APP_VERSION__ is not defined" under test.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.1.0'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
