import { defineConfig } from 'vitest/config'
import { labBrowser } from './browser-provider.mjs'
import { writeLabArtifact } from './scripts/artifacts.mjs'
import { composedInput, residentInput } from './scripts/resident-input.mjs'

const labelReadback = process.env.VITE_LAB_RESIDENT_READBACK === '1'
// eslint-disable-next-line import/no-default-export
export default defineConfig({
  optimizeDeps: {
    include: ['@luma.gl/shaders', 'markdown-it', 'd3-scale', 'd3-array', ...(labelReadback ? ['@interacta/css-labels'] : [])],
  },
  define: {
    'import.meta.env.REQUIRE_WEBGPU': true,
    'import.meta.env.LAB_SOURCE_REVISION': JSON.stringify(process.env.LAB_SOURCE_REVISION ?? ''),
    'import.meta.env.LAB_SOURCE_SNAPSHOT': JSON.stringify(process.env.LAB_SOURCE_SNAPSHOT ?? ''),
    'import.meta.env.LAB_NATIVE_GPU': process.env.LAB_SWIFTSHADER !== '1',
    'import.meta.env.LAB_SCALE_COUNT': Number(process.env.LAB_SCALE_COUNT ?? 0),
    'import.meta.env.LAB_RESIDENT_HIERARCHY_SCALE': process.env.LAB_RESIDENT_HIERARCHY_SCALE === '1',
    'import.meta.env.LAB_RUN_ID': JSON.stringify(process.env.LAB_ARTIFACT_RUN ?? ''),
  },
  test: {
    include: ['src/experiments/**/*.test.ts'],
    testTimeout: 60000,
    maxWorkers: 1,
    browser: { ...labBrowser(), commands: { writeLabArtifact, residentInput, composedInput } },
  },
})
