import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import type { BrowserCommandContext } from 'vitest/node'
import { writeLabArtifact } from './experiments/cosmos-gpu-lab/scripts/artifacts.mjs'
import { crashIsolatedGpu } from './experiments/cosmos-gpu-lab/src/testing/gpu-process-loss'

const nativeHost = process.env['VITE_LAB_NATIVE_PRODUCTION_HOST'] === '1'

async function writeNativeHost ({ testPath }: BrowserCommandContext, json: string): Promise<void> {
  const root = resolve(__dirname, 'experiments/cosmos-gpu-lab')
  await writeLabArtifact({ project: { config: { root } }, testPath }, 'production-deck-loss', json)
}

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
    provide: { nativeProductionHost: nativeHost },
    // The experimental lab runs separately with its own WebGPU browser setup
    // and luma v10 dependency optimizer: pnpm --filter @cosmos.gl/gpu-lab test:gpu.
    include: ['test/**/*.test.ts'],
    // Device init and shader compilation on SwiftShader are slow
    testTimeout: 30000,
    // Browser workers are pages sharing one Chromium process. In CI every
    // WebGL context uses CPU-backed SwiftShader, so parallel files compete for
    // the same runner cores and make otherwise deterministic GPU tests cross
    // their timeout. Keep local development parallel; give CI one full-speed
    // browser page.
    maxWorkers: nativeHost || process.env['CI'] ? 1 : undefined,
    browser: {
      enabled: true,
      headless: !nativeHost,
      provider: playwright(nativeHost ? { launchOptions: { channel: 'chrome' } } : undefined),
      ...(nativeHost ? { commands: { crashIsolatedGpu, writeNativeHost } } : {}),
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
