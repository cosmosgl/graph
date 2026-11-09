import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// Explicit opt-in for GPU regression tests; fail if no adapter can be created.
// These flags allow Chromium's software WebGPU adapter on machines without hardware access.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  define: { 'import.meta.env.REQUIRE_WEBGPU': true },
  test: {
    include: ['src/gpu/**/*.test.ts', 'src/experiments/neighborhood-forces/**/*.test.ts', 'src/experiments/weighted-links/**/*.test.ts', 'src/experiments/many-body/**/*.test.ts'],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
