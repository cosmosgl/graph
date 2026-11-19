import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { compareArray } from '../many-body/reference'
import { createFixture } from '../many-body/data'
import { sharedView, springMismatch } from '../matched-layout/metrics'
import { cool, createGraph } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import type { CombinedBackend } from '../combined-layout/backend'

it.skipIf(!import.meta.env.LAB_REPULSION_FAST_TRAJECTORY)('compares independent native-arithmetic graph trajectories', async () => {
  const runId: string = import.meta.env.LAB_RUN_ID
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId)) throw new Error('A valid unique artifact run is required')
  if (!import.meta.env.LAB_SOURCE_REVISION || !import.meta.env.LAB_SOURCE_SNAPSHOT) throw new Error('Source snapshot and revision are required')
  if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('A visible browser is required')
  const scenarios = [
    { label: 'Corrected', farMode: 'workgroup-local' as const, nearArithmetic: 'refined' as const },
    { label: 'Native near', farMode: 'workgroup-local' as const, nearArithmetic: 'native' as const },
    { label: 'Native both', farMode: 'workgroup-native-far' as const, nearArithmetic: 'native' as const },
    { label: 'Factorized both', farMode: 'workgroup-factorized-far' as const, nearArithmetic: 'factorized' as const },
  ]
  const smoke = import.meta.env.LAB_FAST_TRAJECTORY_SMOKE
  const report: {
    browser: string; visibility: string; sourceRevision: string; sourceSnapshot: string; luma: string;
    comparison: string[]; status: string; screenshots: string[]; error?: string; cases: unknown[];
  } = {
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    luma: '10.0.0-alpha.15',
    comparison: scenarios.map(value => value.label),
    status: 'running',
    screenshots: [],
    cases: [],
  }
  await page.viewport(2050, 650)
  try {
    const cases = [
      ['uniform', 'communities', 8192], ['clusters', 'communities', 16384], ['uniform', 'star', 8192],
    ] as const
    for (const [distribution, fixture, count] of smoke ? cases.slice(0, 1) : cases) {
      const { graph, input } = createGraph({ count, fixture, decay: 200 })
      if (distribution === 'clusters') input.points.set(createFixture('clusters', count).points)
      for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] -= 2048 }
      input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
      const initial = input.points.slice()
      const settings = { ...forceSettings('varied32', count), center: 0.1, origin: [2048, -2048] as [number, number] }
      const panel = document.createElement('section')
      panel.style.cssText = 'display:flex;gap:16px;padding:16px;background:#1e2530;color:white;font:16px sans-serif;width:1980px'
      const canvases = scenarios.map(({ label }) => {
        const item = document.createElement('article'); const title = document.createElement('p'); title.textContent = label; item.append(title)
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; item.append(canvas); panel.append(item)
        return canvas
      })
      document.body.append(panel)
      const backends: CombinedBackend[] = []; const rows: unknown[] = []
      try {
        for (const [index, scenario] of scenarios.entries()) {
          backends.push(await createCombinedWebGPU(canvases[index], graph, input, 'trig', {
            forceSettings: settings,
            repulsionPolicy: 'production',
            gpuBounds: true,
            gridAggregation: 'cached-small',
            springOptimization: 'prefetch',
            farMode: scenario.farMode,
            nearArithmetic: scenario.nearArithmetic,
          }))
        }
        const info = backends.map(backend => backend.positionSource!().device.info)
        if (info.some(value => value.fallback !== false)) throw new Error('A non-fallback WebGPU adapter is required')
        const record: { distribution: string; fixture: string; count: number; links: number; ticks: number; alpha: number;
          info: typeof info; rows: unknown[]; } = { distribution, fixture, count, links: graph.links.length / 2, ticks: 0, alpha: 1, info, rows }
        report.cases.push(record)
        let alpha = 1
        for (let tick = 1; tick <= (smoke ? 3 : 200); tick++) {
          backends.forEach(backend => backend.stepTick!(alpha, tick - 1)); alpha = cool(alpha, 200)
          if (![1, 10, 50, 100, 200, ...(smoke ? [3] : [])].includes(tick)) continue
          const positions = await Promise.all(backends.map(async backend => (await backend.read()).positions))
          const view = sharedView(positions)
          let finite = true; let flagsExact = true; let pinsExact = true; let absentExact = true
          for (let i = 0; i < initial.length; i += 4) {
            for (const points of positions) {
              flagsExact = flagsExact && points[i + 2] === initial[i + 2] && points[i + 3] === initial[i + 3]
              if (initial[i + 2] > 0.5) pinsExact = pinsExact && points[i] === initial[i] && points[i + 1] === initial[i + 1]
              if (initial[i + 3] <= 0.5) finite = finite && Number.isFinite(points[i]) && Number.isFinite(points[i + 1])
              else absentExact = absentExact && Object.is(points[i], initial[i]) && Object.is(points[i + 1], initial[i + 1])
            }
          }
          const comparisons = positions.slice(1).map((points, lane) => {
            let total = 0; let max = 0; let pixels2 = 0; let maxPixels = 0; let present = 0; let overPixel = 0
            for (let i = 0; i < initial.length; i += 4) {
              if (initial[i + 3] > 0.5) continue
              const dx = points[i] - positions[0][i]; const dy = points[i + 1] - positions[0][i + 1]
              const delta = Math.hypot(dx, dy); const pixels = Math.hypot(dx * view[2] * 240, dy * view[3] * 170)
              total += delta * delta; max = Math.max(max, delta); pixels2 += pixels * pixels; maxPixels = Math.max(maxPixels, pixels)
              if (pixels > 1) overPixel++; present++
            }
            return {
              variant: scenarios[lane + 1].label,
              strict: compareArray(points, positions[0], initial),
              rmsDifference: Math.sqrt(total / present),
              maxDifference: max,
              rmsPixels: Math.sqrt(pixels2 / present),
              maxPixels,
              overPixel,
            }
          })
          rows.push({
            tick,
            finite,
            flagsExact,
            pinsExact,
            absentExact,
            comparisons,
            springMismatch: positions.map(points => springMismatch(points, graph, settings)),
          })
          record.ticks = tick; record.alpha = alpha
          if ([1, 50, 200].includes(tick)) {
            backends.forEach(backend => backend.render(view))
            await Promise.all(backends.map(backend => waitForGpu(backend.positionSource!().device)))
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const path = `../../../captures/${runId}/${fixture}-${distribution}-${count}-tick-${tick}.png`
            report.screenshots.push(await page.screenshot({ element: panel, path }))
          }
          await writeArtifact('repulsion-fast-trajectories', report)
          expect(finite && flagsExact && pinsExact && absentExact, JSON.stringify({ fixture, distribution, count, tick })).toBe(true)
        }
      } finally { backends.forEach(backend => backend.destroy()); panel.remove() }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally { await writeArtifact('repulsion-fast-trajectories', report) }
  expect(report.status, report.error).toBe('complete')
}, 900000)
