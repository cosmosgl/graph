import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { positionStats } from './compare'
import { forcePositions } from './fixture'
import { createForcePreview } from './frame'

// Dedicated opt-in capture: never time two packages concurrently or interleave with the parity suite.
it.runIf(import.meta.env.VITE_LAB_FORCE_TIMING === '1')('measures a packaged hierarchical step, draw and position readback', async () => {
  const initial = forcePositions('hierarchy')
  const trials = []
  for (const engine of ['webgl', 'webgpu', 'webgl'] as const) {
    const graph = await createForcePreview(document.body, engine, 'hierarchy')
    try {
      expect(document.visibilityState).toBe('visible')
      expect(graph.device.gpuType).not.toBe('cpu')
      if (engine === 'webgpu') expect(graph.device.fallback).toBe(false)
      let xy = await graph.advance(0)
      for (let i = 0; i < 4; i++) xy = await graph.advance(1)
      const samplesMs: number[] = []
      for (let i = 0; i < 24; i++) {
        // The preceding public readback completed before this timestamp.
        const start = performance.now()
        xy = await graph.advance(1)
        samplesMs.push(performance.now() - start)
      }
      expect(positionStats(xy, initial).rmsDelta).toBeGreaterThan(1)
      const sorted = [...samplesMs].sort((a, b) => a - b)
      const p50 = (sorted[11] + sorted[12]) / 2
      const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
      trials.push({ engine, device: graph.device, samplesMs, p50, p95 })
    } finally { graph.destroy() }
  }
  await writeArtifact('package-forces-hierarchy-timing', {
    trials,
    browser: navigator.userAgent,
    warmup: 4,
    ticks: [5, 28],
    viewport: [288, 192],
    pixelRatio: 1,
    revision: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
  })
})
