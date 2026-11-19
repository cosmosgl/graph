import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { centerCostSummary, measureCenterCost } from '../combined-layout/center-cost'
import { createGraph } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { createCombinedWebGPU } from '../combined-layout/webgpu'

it.skipIf(!import.meta.env.LAB_CENTER_FRAME_COST)('records the bounded combined frame and graph-size guard', async () => {
  const device = await createDevice('webgpu')
  const identity = device.info; device.destroy()
  const count = import.meta.env.LAB_SCALE_COUNT || 8192
  const settings = {
    count,
    fixture: 'chain' as const,
    distribution: 'uniform' as const,
    ticks: 100,
    checkpointEvery: 10,
    preset: 'varied32' as const,
    pinned: true,
    center: 1,
  }
  let guard = ''
  const large = createGraph({ count: 16385, fixture: 'chain', decay: 100 })
  try {
    const graph = await createCombinedWebGPU(document.createElement('canvas'), large.graph, large.input, 'trig', {
      forceSettings: { ...forceSettings('varied32', 16385), center: 1 },
    })
    graph.destroy(); guard = 'Unexpectedly accepted 16,385 points'
  } catch (error) { guard = String(error) }
  const { input } = createGraph({ count, fixture: 'chain', decay: 100 })
  for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] += 2048 }
  const report = {
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: identity,
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    luma: '10.0.0-alpha.15',
    centerForceVariant: import.meta.env.LAB_CENTER_LINEAR_FRAME ? 'linear' as const : 'refined' as const,
    guard,
    status: 'running',
    cost: null as Awaited<ReturnType<typeof measureCenterCost>> | null,
    summary: null as { webgl: ReturnType<typeof centerCostSummary>; webgpu: ReturnType<typeof centerCostSummary> } | null,
  }
  try {
    if (!report.sourceSnapshot || !report.sourceRevision) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || identity.fallback !== false) {
      throw new Error('The timed study requires a visible browser and non-fallback WebGPU adapter')
    }
    await writeArtifact('center-frame', report)
    report.cost = await measureCenterCost(settings, input.points, 1, 0, 32, () => {}, () => false,
      { warmups: 2, samples: 7, frames: 1, blocks: 1 }, report.centerForceVariant)
    report.summary = {
      webgl: centerCostSummary(report.cost, 'webgl', 0),
      webgpu: centerCostSummary(report.cost, 'webgpu', 0),
    }
    report.status = report.cost.status
  } finally { await writeArtifact('center-frame', report) }
  expect(guard).not.toContain('Unexpectedly accepted')
  expect(report.status).toBe('complete')
}, 900000)
