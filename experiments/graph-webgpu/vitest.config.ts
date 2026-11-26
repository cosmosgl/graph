import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { swiftShaderArgs } from '../../scripts/chromium-swiftshader.mjs'
import { sharedSource } from './vite.config'

const software = process.env['COSMOS_TEST_SWIFTSHADER'] === '1'

export default defineConfig({
  resolve: { alias: {
    '@/graph': sharedSource,
    '@cosmos.gl/graph': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
  } },
  define: { 'import.meta.env.COSMOS_TEST_SWIFTSHADER': software },
  optimizeDeps: {
    include: ['@luma.gl/core', '@luma.gl/core/webgl', '@luma.gl/core/webgpu', '@luma.gl/graph', 'd3-selection', 'd3-transition', 'd3-zoom', 'd3-drag'],
  },
  test: {
    include: ['test/**/*.test.ts'],
    ...(software ? { testTimeout: 30000, maxWorkers: 1 } : {}),
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ launchOptions: software
        ? { channel: 'chromium', args: swiftShaderArgs }
        : { channel: 'chrome', args: ['--enable-unsafe-webgpu'] },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
