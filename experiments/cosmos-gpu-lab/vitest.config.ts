import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// ANGLE alone enables WebGL, but Linux headless WebGPU canvas presentation also
// needs Vulkan compositing. Without it, canvas allocation loses the device and
// later readbacks fail even though offscreen compute/rendering works.
const softwareArgs = [
  '--enable-unsafe-webgpu', '--use-angle=swiftshader',
  ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader', '--enable-features=Vulkan'] : []),
]
const browserProvider = playwright({ launchOptions: { ...(process.env.LAB_NATIVE_GPU === '1' ? { channel: 'chrome', args: ['--enable-unsafe-webgpu'] }
  : { args: softwareArgs }) } })
// Run the real suite in a user-selected inline browser without launching Chrome.
// Open the printed session URL through the Codex browser tool to start the tests.
if (process.env.LAB_INLINE_BROWSER === '1') {
  browserProvider.name = 'codex-inline'
  browserProvider.providerFactory = () => ({
    name: 'codex-inline', supportsParallelism: false, getCommandsContext: () => ({}),
    openPage: async (_session, url): Promise<void> => { process.stdout.write(`\nOpen inline test session: ${url}\n`) },
    close: () => {},
  })
}

// Explicit opt-in for GPU regression tests; fail if no adapter can be created.
// Default: software Chromium. LAB_NATIVE_GPU=1 uses installed Chrome without forcing an adapter.
// Full integer-arithmetic shaders currently fail compilation on SwiftShader; those tests opt into native mode.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: { include: ['@luma.gl/shaders', 'markdown-it', 'd3-scale', 'd3-array'] },
  define: {
    'import.meta.env.REQUIRE_WEBGPU': true,
    'import.meta.env.LAB_NATIVE_GPU': process.env.LAB_NATIVE_GPU === '1',
    // Vite define strings are JavaScript expressions; quote the selected mode.
    'import.meta.env.LAB_SCALE_PRECISION': JSON.stringify(process.env.LAB_SCALE_PRECISION ?? 'products'),
    'import.meta.env.LAB_SCALE_COUNT': Number(process.env.LAB_SCALE_COUNT ?? 0),
  },
  test: {
    include: [
      'src/app/**/*.test.ts',
      'src/gpu/**/*.test.ts',
      'src/runtime/**/*.test.ts',
      'src/experiments/neighborhood-forces/**/*.test.ts',
      'src/experiments/weighted-links/**/*.test.ts',
      'src/experiments/many-body/**/*.test.ts',
      'src/experiments/many-body-grid/**/*.test.ts',
      'src/experiments/repulsion-trajectories/**/*.test.ts',
      'src/experiments/combined-layout/**/*.test.ts',
      'src/experiments/matched-layout/**/*.test.ts',
      'src/experiments/collision/**/*.test.ts',
      'src/experiments/precision-diagnostics/**/*.test.ts',
      'src/experiments/point-styling/**/*.test.ts',
      'src/experiments/straight-links/**/*.test.ts',
      'src/experiments/curved-links/**/*.test.ts',
    ],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: process.env.LAB_INLINE_BROWSER !== '1',
      connectTimeout: process.env.LAB_INLINE_BROWSER === '1' ? 180000 : 60000,
      screenshotFailures: false,
      provider: browserProvider,
      instances: [{ browser: 'chromium' }],
    },
  },
})
