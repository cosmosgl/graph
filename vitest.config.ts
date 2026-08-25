import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// cosmos.gl is a WebGL 2 engine — its tests need a real GPU context, not a DOM
// emulation, so the suite runs in headless Chromium (SwiftShader) through
// vitest browser mode. `npm test` runs it once; `npm run test:watch` watches.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  resolve: {
    alias: {
      '@/graph': resolve(__dirname, 'src/'),
      '@cosmos.gl/graph': resolve(__dirname, 'src/'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Device init and shader compilation on SwiftShader are slow
    testTimeout: 30000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
