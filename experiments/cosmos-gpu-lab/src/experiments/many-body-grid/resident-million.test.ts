import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { createDevice, waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { cool } from '../combined-layout/data'
import { median } from '../many-body/timing'
import { createResidentChain, createResidentGraph } from './resident-graph'

it.skipIf(!import.meta.env.LAB_RESIDENT_MILLION)('runs a moving graph with a GPU-built hierarchy', async () => {
  const runId: string = import.meta.env.LAB_RUN_ID
  const count = import.meta.env.LAB_SCALE_COUNT || 1000000
  const ticks = import.meta.env.LAB_RESIDENT_TICKS || 10
  const report: {
    browser: string; visibility: string; sourceRevision: string; sourceSnapshot: string; luma: string;
    count: number; links: number; policy: unknown; device?: unknown; webgl?: unknown; limits?: unknown;
    hierarchyBytes?: number; linkBytes?: number; topologyMs?: number; setupMs?: number;
    samples: number[]; warmups: number[]; medianMs?: number; rangeMs?: number[]; result?: unknown;
    screenshot?: string; status: string; phase: string; error?: string; deviceLoss?: unknown;
  } = {
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    luma: '10.0.0-alpha.15',
    count,
    links: count - 1,
    policy: {
      fixture: 'deterministic uniform chain',
      warmups: 3,
      samples: ticks - 3,
      slots: 8,
      decay: 200,
      canvas: [480, 340],
      stages: ['gravity', 'hierarchy + native repulsion', 'incoming springs', 'outgoing springs', 'GPU camera fit', 'draw links and points'],
      metric: 'CPU submission to GPU completion; one wait per evolving frame',
      readbackDuringTiming: false,
    },
    samples: [],
    warmups: [],
    status: 'running',
    phase: 'setup',
  }
  let backend: Awaited<ReturnType<typeof createResidentGraph>> | undefined
  try {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId)) throw new Error('A unique artifact run is required')
    if (!Number.isInteger(ticks) || ticks < 4 || ticks > 200) throw new Error('Expected 4–200 ticks')
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('A source revision and snapshot are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('A visible browser is required')
    await writeArtifact('resident-million', report)
    const webgl = await createDevice('webgl', document.createElement('canvas')); report.webgl = webgl.info; webgl.destroy()
    await page.viewport(1000, 700)
    const panel = document.createElement('section'); panel.style.cssText = 'padding:16px;background:#1e2530;color:white;font:16px sans-serif'
    const title = document.createElement('p'); title.textContent = `${count.toLocaleString()} moving points · ${count - 1} links · WebGPU`
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
    panel.append(title, canvas); document.body.append(panel)
    const { input, graph } = createResidentChain(count); const initial = input.points.slice()
    const setup = performance.now(); backend = await createResidentGraph(canvas, input, graph); report.setupMs = performance.now() - setup
    report.device = backend.device.info
    report.limits = {
      maxStorageBufferBindingSize: backend.device.limits.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: backend.device.limits.maxStorageBuffersPerShaderStage,
      maxBufferSize: backend.device.limits.maxBufferSize,
    }
    report.hierarchyBytes = backend.hierarchyBytes; report.linkBytes = backend.linkBytes; report.topologyMs = backend.topologyMs
    if (backend.device.info.fallback !== false) throw new Error('A non-fallback GPU is required')
    let alpha = 1
    for (let tick = 0; tick < ticks; tick++) {
      report.phase = `tick ${tick + 1}`; await writeArtifact('resident-million', report)
      if (document.visibilityState !== 'visible') throw new Error('The browser became hidden')
      const start = performance.now(); backend.frame(tick, alpha)
      await waitForGpu(backend.device, 30000)
      const elapsed = performance.now() - start
      if (document.visibilityState !== 'visible') throw new Error('The browser became hidden')
      ;(tick < 3 ? report.warmups : report.samples).push(elapsed)
      alpha = cool(alpha, 200)
    }
    report.medianMs = median(report.samples); report.rangeMs = [Math.min(...report.samples), Math.max(...report.samples)]
    report.phase = 'validation'; await writeArtifact('resident-million', report)
    const result = await backend.read()
    let finite = true; let flags = true; let pinned = true; let absent = true; let moved = 0; let squared = 0; let maxDisplacement = 0
    for (let i = 0; i < count; i++) {
      const o = i * 4; const before = initial.subarray(o, o + 4); const after = result.positions.subarray(o, o + 4)
      flags &&= before[2] === after[2] && before[3] === after[3]
      if (before[2] > 0.5) pinned &&= Object.is(before[0], after[0]) && Object.is(before[1], after[1])
      if (before[3] > 0.5) absent &&= Object.is(before[0], after[0]) && Object.is(before[1], after[1])
      else {
        finite &&= Number.isFinite(after[0]) && Number.isFinite(after[1])
        const d = Math.hypot(after[0] - before[0], after[1] - before[1]); if (d > 0.01) moved++
        squared += d * d; maxDisplacement = Math.max(maxDisplacement, d)
      }
    }
    report.result = { ticks, finite, flags, pinned, absent, moved, rmsDisplacement: Math.sqrt(squared / (count - 1)), maxDisplacement }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    report.screenshot = await page.screenshot({ element: panel, path: `../../../captures/${runId}/resident-million.png` })
    if (!finite || !flags || !pinned || !absent || moved < count / 2) throw new Error(`Invalid moving graph: ${JSON.stringify(report.result)}`)
    report.phase = 'complete'; report.status = 'complete'
  } catch (error) {
    report.status = 'error'; report.error = String(error)
    if (backend?.device.isLost) report.deviceLoss = await backend.device.lost
  } finally { await writeArtifact('resident-million', report); backend?.destroy() }
  expect(report.status, report.error).toBe('complete')
}, 900000)
