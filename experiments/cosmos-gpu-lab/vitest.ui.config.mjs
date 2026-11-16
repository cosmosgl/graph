import { defineConfig } from 'vitest/config'
import { labBrowser } from './browser-provider.mjs'

// App contracts only. No adapter flags, numerical opt-ins or performance sweeps.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: { include: ['markdown-it', 'd3-scale', 'd3-array'] },
  test: {
    include: ['src/app/**/*.test.ts', 'src/runtime/**/*.test.ts'],
    setupFiles: ['./src/testing/no-gpu.ts'],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: labBrowser(false),
  },
})
