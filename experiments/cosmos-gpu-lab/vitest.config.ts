import { defineConfig } from 'vitest/config'
import { labBrowser } from './browser-provider.mjs'
import { writeLabArtifact } from './scripts/artifacts.mjs'

// Local research checks use the current machine's native browser/GPU.
// Keep the legacy flag for existing native-only tests and historical reproduction commands.
// Expensive sweeps still require their own explicit flags.
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: { include: ['@luma.gl/shaders', 'markdown-it', 'd3-scale', 'd3-array'] },
  define: {
    'import.meta.env.REQUIRE_WEBGPU': true,
    'import.meta.env.LAB_STORED_ALPHA_SWEEP': process.env.LAB_STORED_ALPHA_SWEEP === '1',
    'import.meta.env.LAB_RIBBON_COST': process.env.LAB_RIBBON_COST === '1',
    'import.meta.env.LAB_FAR_ARITHMETIC_COST': process.env.LAB_FAR_ARITHMETIC_COST === '1',
    'import.meta.env.LAB_NATIVE_GPU': true,
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
      'src/experiments/ribbon-generation/**/*.test.ts',
    ],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: { ...labBrowser(true), commands: { writeLabArtifact } },
  },
})
