import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { compareArray } from '../many-body/reference'
import { sharedView, springMismatch } from '../matched-layout/metrics'
import { cool, createGraph } from '../combined-layout/data'
import { createFixture } from '../many-body/data'
import { forceSettings } from '../combined-layout/production-settings'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import type { CombinedBackend } from '../combined-layout/backend'

it.skipIf(!import.meta.env.LAB_FAR_ALTERNATIVE_TRAJECTORY)('records direct and stored independent graph trajectories and matched previews', async () => {
  const runId: string = import.meta.env.LAB_RUN_ID
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId)) throw new Error('A valid unique artifact run is required')
  if (!import.meta.env.LAB_SOURCE_REVISION || !import.meta.env.LAB_SOURCE_SNAPSHOT) throw new Error('Source snapshot and revision are required')
  if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('A visible browser is required')
  const workgroup = import.meta.env.LAB_FAR_WORKGROUP_TRAJECTORY
  const local = import.meta.env.LAB_FAR_WORKGROUP_LOCAL_TRAJECTORY
  const candidate = local
    ? { label: 'Workgroup without barrier', farMode: 'workgroup-local' as const }
    : workgroup ? { label: 'Workgroup scratch', farMode: 'workgroup' as const } : { label: 'Direct accumulation', farMode: 'refined' as const }
  const scenarios = [{ label: 'Stored contributions', farMode: 'streamed' as const },
    candidate]
  const artifact = local ? 'repulsion-workgroup-local-trajectories' : workgroup ? 'repulsion-workgroup-trajectories' : 'repulsion-direct-trajectories'
  const report: {
    browser: string; visibility: string; sourceRevision: string; sourceSnapshot: string; luma: string;
    comparison: string[]; status: string; screenshots?: string[]; error?: string; cases: unknown[];
  } = {
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    luma: '10.0.0-alpha.15',
    comparison: scenarios.map(s => s.label),
    status: 'running',
    cases: [],
    screenshots: [],
  }
  await page.viewport(1100, 650)
  try {
    for (const [fixture, count] of [['uniform', 8192], ['clusters', 16384]] as const) {
      const { graph, input } = createGraph({ count, fixture: 'communities', decay: 200 })
      if (fixture === 'clusters') input.points.set(createFixture('clusters', count).points)
      for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] -= 2048 }
      input.points[2] = 1
      input.points.set([NaN, NaN, 0, 1], 4)
      const initial = input.points.slice()
      const settings = { ...forceSettings('varied32', count), center: 0.1, origin: [2048, -2048] as [number, number] }
      const panel = document.createElement('section')
      panel.style.cssText = 'display:flex;gap:16px;padding:16px;background:#1e2530;color:white;font:16px sans-serif;width:1000px'
      const canvases = scenarios.map(({ label }) => {
        const item = document.createElement('article')
        const title = document.createElement('p'); title.textContent = label; item.append(title)
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; item.append(canvas); panel.append(item)
        return canvas
      })
      document.body.append(panel)
      const backends: CombinedBackend[] = []
      const rows: unknown[] = []
      try {
        for (const [index, scenario] of scenarios.entries()) {
          backends.push(await createCombinedWebGPU(canvases[index], graph, input, 'trig', {
            forceSettings: settings,
            repulsionPolicy: 'production',
            gpuBounds: true,
            gridAggregation: 'cached-small',
            springOptimization: 'prefetch',
            farMode: scenario.farMode,
          }))
        }
        const info = backends.map(backend => backend.positionSource!().device.info)
        if (info.some(value => value.fallback !== false)) throw new Error('A non-fallback WebGPU adapter is required')
        const record: { fixture: string; count: number; links: number; ticks: number; alpha: number; info: typeof info; view?: number[]; rows: unknown[] } = {
          fixture, count, links: graph.links.length / 2, ticks: 0, alpha: 1, info, rows,
        }
        report.cases.push(record)
        let alpha = 1
        let latest: Float32Array[] = []
        for (let tick = 1; tick <= 200; tick++) {
          backends.forEach(backend => backend.stepTick!(alpha, tick - 1))
          alpha = cool(alpha, 200)
          if (![1, 10, 50, 100, 200].includes(tick)) continue
          latest = await Promise.all(backends.map(async backend => (await backend.read()).positions))
          const strict = compareArray(latest[1], latest[0], initial)
          const checkpointView = sharedView(latest)
          let total = 0; let max = 0; let present = 0; let finite = true; let flagsExact = true; let pinsExact = true; let absentExact = true
          let totalPixels = 0; let maxPixels = 0
          for (let i = 0; i < initial.length; i += 4) {
            for (const points of latest) {
              flagsExact = flagsExact && points[i + 2] === initial[i + 2] && points[i + 3] === initial[i + 3]
              if (initial[i + 2] > 0.5) pinsExact = pinsExact && points[i] === initial[i] && points[i + 1] === initial[i + 1]
              if (initial[i + 3] <= 0.5) finite = finite && Number.isFinite(points[i]) && Number.isFinite(points[i + 1])
              else absentExact = absentExact && Object.is(points[i], initial[i]) && Object.is(points[i + 1], initial[i + 1])
            }
            if (initial[i + 3] > 0.5) continue
            const difference = Math.hypot(latest[1][i] - latest[0][i], latest[1][i + 1] - latest[0][i + 1])
            total += difference * difference; max = Math.max(max, difference); present++
            const pixels = Math.hypot((latest[1][i] - latest[0][i]) * checkpointView[2] * 240,
              (latest[1][i + 1] - latest[0][i + 1]) * checkpointView[3] * 170)
            totalPixels += pixels * pixels; maxPixels = Math.max(maxPixels, pixels)
          }
          rows.push({
            tick,
            finite,
            flagsExact,
            pinsExact,
            absentExact,
            strict,
            rmsDifference: Math.sqrt(total / present),
            maxDifference: max,
            rmsPixels: Math.sqrt(totalPixels / present),
            maxPixels,
            springMismatch: latest.map(points => springMismatch(points, graph, settings)),
          })
          record.ticks = tick; record.alpha = alpha
          if ([1, 50, 200].includes(tick)) {
            backends.forEach(backend => backend.render(checkpointView))
            await Promise.all(backends.map(backend => waitForGpu(backend.positionSource!().device)))
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            report.screenshots!.push(await page.screenshot({ element: panel, path: `../../../captures/${runId}/${fixture}-${count}-tick-${tick}.png` }))
          }
          record.view = checkpointView
          await writeArtifact(artifact, report)
          expect(finite && flagsExact && pinsExact && absentExact, JSON.stringify({ count, tick, finite, flagsExact, pinsExact, absentExact })).toBe(true)
        }
      } finally { backends.forEach(backend => backend.destroy()); panel.remove() }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally { await writeArtifact(artifact, report) }
  expect(report.status, report.error).toBe('complete')
}, 900000)
