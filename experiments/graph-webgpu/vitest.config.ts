import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { sharedSource } from './vite.config'

export default defineConfig({
  resolve: { alias: { '@/graph': sharedSource } },
  optimizeDeps: {
    include: ['@luma.gl/core', '@luma.gl/core/webgl', '@luma.gl/core/webgpu', '@luma.gl/graph', 'd3-selection', 'd3-transition', 'd3-zoom', 'd3-drag'],
  },
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ launchOptions: { channel: 'chrome', args: ['--enable-unsafe-webgpu'] } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
