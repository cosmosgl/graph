import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// Explicit opt-in for GPU regression tests; fail if no adapter can be created.
// Default: software Chromium. LAB_NATIVE_GPU=1 uses installed Chrome without forcing an adapter.
// Full integer-arithmetic shaders currently fail compilation on SwiftShader; those tests opt into native mode.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: { include: ['@luma.gl/shadertools'] },
  define: { 'import.meta.env.REQUIRE_WEBGPU': true, 'import.meta.env.LAB_NATIVE_GPU': process.env.LAB_NATIVE_GPU === '1' },
  test: {
    include: [
      'src/gpu/**/*.test.ts',
      'src/experiments/neighborhood-forces/**/*.test.ts',
      'src/experiments/weighted-links/**/*.test.ts',
      'src/experiments/many-body/**/*.test.ts',
      'src/experiments/many-body-grid/**/*.test.ts',
      'src/experiments/repulsion-trajectories/**/*.test.ts',
      'src/experiments/combined-layout/**/*.test.ts',
    ],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ launchOptions: { ...(process.env.LAB_NATIVE_GPU === '1' ? { channel: 'chrome', args: ['--enable-unsafe-webgpu'] }
        : { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] }) } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
