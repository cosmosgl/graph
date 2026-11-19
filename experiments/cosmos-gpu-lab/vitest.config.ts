import { defineConfig } from 'vitest/config'
import { labBrowser } from './browser-provider.mjs'
import { writeLabArtifact } from './scripts/artifacts.mjs'
import { composedInput, residentInput } from './scripts/resident-input.mjs'

// Local research checks use the current machine's native browser/GPU.
// Keep the legacy flag for existing native-only tests and historical reproduction commands.
// Expensive sweeps still require their own explicit flags.
const deckHost = process.env.LAB_DECK_HOST === '1'
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: {
    include: ['@luma.gl/shaders', 'markdown-it', 'd3-scale', 'd3-array', ...(deckHost
      ? ['@deck.gl/core', '@luma.gl/core', '@luma.gl/core/webgl', '@luma.gl/core/webgpu', '@luma.gl/engine', '@luma.gl/graph']
      : [])],
  },
  define: {
    'import.meta.env.REQUIRE_WEBGPU': true,
    'import.meta.env.LAB_STORED_ALPHA_SWEEP': process.env.LAB_STORED_ALPHA_SWEEP === '1',
    'import.meta.env.LAB_PRECISION_REPLAY': process.env.LAB_PRECISION_REPLAY === '1',
    'import.meta.env.LAB_SOURCE_REVISION': JSON.stringify(process.env.LAB_SOURCE_REVISION ?? ''),
    'import.meta.env.LAB_WORKTREE_STATE': JSON.stringify(process.env.LAB_WORKTREE_STATE ?? ''),
    'import.meta.env.LAB_SOURCE_SNAPSHOT': JSON.stringify(process.env.LAB_SOURCE_SNAPSHOT ?? ''),
    'import.meta.env.LAB_RIBBON_COST': process.env.LAB_RIBBON_COST === '1',
    'import.meta.env.LAB_FAR_ARITHMETIC_COST': process.env.LAB_FAR_ARITHMETIC_COST === '1',
    'import.meta.env.LAB_NATIVE_GPU': true,
    // Vite define strings are JavaScript expressions; quote the selected mode.
    'import.meta.env.LAB_SCALE_PRECISION': JSON.stringify(process.env.LAB_SCALE_PRECISION ?? 'products'),
    'import.meta.env.LAB_SCALE_COUNT': Number(process.env.LAB_SCALE_COUNT ?? 0),
    'import.meta.env.LAB_CENTER_SCALE': process.env.LAB_CENTER_SCALE === '1',
    'import.meta.env.LAB_CENTER_FRAME_COST': process.env.LAB_CENTER_FRAME_COST === '1',
    'import.meta.env.LAB_CENTER_LINEAR_FRAME': process.env.LAB_CENTER_LINEAR_FRAME === '1',
    'import.meta.env.LAB_CENTER_TRAJECTORY': process.env.LAB_CENTER_TRAJECTORY === '1',
    'import.meta.env.LAB_CENTER_ONCE': process.env.LAB_CENTER_ONCE === '1',
    'import.meta.env.LAB_CENTER_ONCE_FRAME': process.env.LAB_CENTER_ONCE_FRAME === '1',
    'import.meta.env.LAB_CENTER_ONCE_TRAJECTORY': process.env.LAB_CENTER_ONCE_TRAJECTORY === '1',
    'import.meta.env.LAB_REPULSION_CHUNK': process.env.LAB_REPULSION_CHUNK === '1',
    'import.meta.env.LAB_REPULSION_MEMORY': process.env.LAB_REPULSION_MEMORY === '1',
    'import.meta.env.LAB_REPULSION_CSR': process.env.LAB_REPULSION_CSR === '1',
    'import.meta.env.LAB_REPULSION_DIVIDE': process.env.LAB_REPULSION_DIVIDE === '1',
    'import.meta.env.LAB_FAR_ALTERNATIVES': process.env.LAB_FAR_ALTERNATIVES === '1',
    'import.meta.env.LAB_FAR_ALTERNATIVE_TRAJECTORY': process.env.LAB_FAR_ALTERNATIVE_TRAJECTORY === '1',
    'import.meta.env.LAB_FAR_WORKGROUP_TRAJECTORY': process.env.LAB_FAR_WORKGROUP_TRAJECTORY === '1',
    'import.meta.env.LAB_FAR_WORKGROUP_LOCAL_TRAJECTORY': process.env.LAB_FAR_WORKGROUP_LOCAL_TRAJECTORY === '1',
    'import.meta.env.LAB_FAR_SCALE': process.env.LAB_FAR_SCALE === '1',
    'import.meta.env.LAB_REPULSION_FAST': process.env.LAB_REPULSION_FAST === '1',
    'import.meta.env.LAB_REPULSION_FAST_TRAJECTORY': process.env.LAB_REPULSION_FAST_TRAJECTORY === '1',
    'import.meta.env.LAB_REPULSION_GPU_ORDER': process.env.LAB_REPULSION_GPU_ORDER === '1',
    'import.meta.env.LAB_RESIDENT_MILLION': process.env.LAB_RESIDENT_MILLION === '1',
    'import.meta.env.LAB_CELL_FIELD_STUDY': process.env.LAB_CELL_FIELD_STUDY === '1',
    'import.meta.env.LAB_DENSE_COMMUNITIES': process.env.LAB_DENSE_COMMUNITIES === '1',
    'import.meta.env.LAB_DENSE_GRID_PROFILE': process.env.LAB_DENSE_GRID_PROFILE === '1',
    'import.meta.env.LAB_MOUSE_REPULSION_STUDY': process.env.LAB_MOUSE_REPULSION_STUDY === '1',
    'import.meta.env.LAB_COMPOSED_FORCE_TIMING': process.env.LAB_COMPOSED_FORCE_TIMING === '1',
    'import.meta.env.LAB_RESIDENT_HIERARCHY_SCALE': process.env.LAB_RESIDENT_HIERARCHY_SCALE === '1',
    'import.meta.env.LAB_RESIDENT_TICKS': Number(process.env.LAB_RESIDENT_TICKS ?? 10),
    'import.meta.env.LAB_FAST_TRAJECTORY_SMOKE': process.env.LAB_FAST_TRAJECTORY_SMOKE === '1',
    'import.meta.env.LAB_RUN_ID': JSON.stringify(process.env.LAB_ARTIFACT_RUN ?? ''),
  },
  test: {
    include: deckHost ? ['scripts/deck-host.test.mts'] : [
      'src/app/**/*.test.ts',
      'src/gpu/**/*.test.ts',
      'src/runtime/**/*.test.ts',
      'src/experiments/neighborhood-forces/**/*.test.ts',
      'src/experiments/weighted-links/**/*.test.ts',
      'src/experiments/many-body/**/*.test.ts',
      'src/experiments/many-body-grid/**/*.test.ts',
      'src/experiments/million-graph/**/*.test.ts',
      'src/experiments/repulsion-trajectories/**/*.test.ts',
      'src/experiments/combined-layout/**/*.test.ts',
      'src/experiments/center-mass/**/*.test.ts',
      'src/experiments/integrated-webgpu/**/*.test.ts',
      'src/experiments/viewer-comparison/**/*.test.ts',
      'src/experiments/pilot-viewer/**/*.test.ts',
      'src/experiments/matched-layout/**/*.test.ts',
      'src/experiments/collision/**/*.test.ts',
      'src/experiments/cluster-attraction/**/*.test.ts',
      'src/experiments/point-attractors/**/*.test.ts',
      'src/experiments/mouse-repulsion/**/*.test.ts',
      'src/experiments/selection/**/*.test.ts',
      'src/experiments/precision-diagnostics/**/*.test.ts',
      'src/experiments/point-styling/**/*.test.ts',
      'src/experiments/straight-links/**/*.test.ts',
      'src/experiments/smoothstep-coverage/**/*.test.ts',
      'src/experiments/curved-links/**/*.test.ts',
      'src/experiments/ribbon-generation/**/*.test.ts',
    ],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: { ...labBrowser(true), commands: { writeLabArtifact, residentInput, composedInput } },
  },
})
