import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// cosmos.gl is a WebGL 2 engine — its tests need a real GPU context, not a DOM
// emulation, so the suite runs in headless Chromium (SwiftShader) through
// vitest browser mode. `pnpm test` runs it once; `pnpm run test:watch` watches.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  resolve: {
    alias: {
      '@/graph': resolve(__dirname, 'src/'),
      '@cosmos.gl/graph': resolve(__dirname, 'src/'),
      '@cosmos.gl/deck-layers': resolve(__dirname, 'integrations/deck-layers/src/'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'experiments/cosmos-gpu-lab/src/**/*.test.ts'],
    // Device init and shader compilation on SwiftShader are slow
    testTimeout: 30000,
    // Browser workers are pages sharing one Chromium process. In CI every
    // WebGL context uses CPU-backed SwiftShader, so parallel files compete for
    // the same runner cores and make otherwise deterministic GPU tests cross
    // their timeout. Keep local development parallel; give CI one full-speed
    // browser page.
    maxWorkers: process.env['CI'] ? 1 : undefined,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
