import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { Device } from '@luma.gl/core'
import { createDevice, waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { cool } from '../combined-layout/data'
import { median } from '../many-body/timing'
import {
  bins, checkpoints, edgeDifferences, edgeInput, layoutDifference, layoutSample, motionChecks, percentile, type LayoutSample,
} from '../million-graph/field-metrics'
import { trackMotion, type MotionResult } from '../million-graph/field-motion'
import { frozenForce } from './frozen-resident-force'
import type { DistantForce } from './resident-cell-field'
import { createResidentChain, createResidentGraph, type Distribution } from './resident-graph'

const study = it.skipIf(!import.meta.env.LAB_CELL_FIELD_STUDY)
const modes: DistantForce[] = ['per-point', 'cell-center', 'four-corners']
const distributions: Distribution[] = ['uniform', 'clusters']
const runId: string = import.meta.env.LAB_RUN_ID
const count = 1000000
const ticks = 200

function visible (): void {
  if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('Use visible native Chrome')
}

async function environment (): Promise<{
  browser: string; webgl: Device['info']; luma: string; source: string; snapshot: string; count: number; links: number;
  ticks: number; seed: number; canvas: number[];
}> {
  visible()
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId) || !import.meta.env.LAB_SOURCE_SNAPSHOT || !import.meta.env.LAB_SOURCE_REVISION) {
    throw new Error('Set a unique run directory and identify the source revision and snapshot')
  }
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  try {
    return {
      browser: navigator.userAgent,
      webgl: webgl.info,
      luma: '10.0.0-alpha.15',
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      count,
      links: count - 1,
      ticks,
      seed: 29471,
      canvas: [480, 340],
    }
  } finally { webgl.destroy() }
}

type Graph = Awaited<ReturnType<typeof createResidentGraph>>
type AfterTick = (graph: Graph, tick: number) => Promise<void>

async function movingRun (distribution: Distribution, mode: DistantForce, timings: number[], afterTick?: AfterTick): Promise<{
  checks: ReturnType<typeof motionChecks>; adapter: Device['info']; hierarchyBytes: number;
}> {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
  const { input, graph } = createResidentChain(count, distribution)
  let backend: Graph | undefined
  try {
    backend = await createResidentGraph(canvas, input, graph, mode)
    if (backend.device.info.fallback !== false) throw new Error('Expected native WebGPU')
    let alpha = 1
    for (let i = 0; i < ticks; i++) {
      visible()
      const start = performance.now()
      backend.frame(i, alpha); await waitForGpu(backend.device, 30000)
      timings.push(performance.now() - start)
      visible()
      alpha = cool(alpha, ticks)
      if (afterTick) await afterTick(backend, i + 1)
    }
    const checks = motionChecks(input.points, await backend.readPositions())
    expect(checks).toEqual({ nonfinite: 0, flagErrors: 0, fixedMoved: 0, freeMoved: count - 2 })
    return { checks, adapter: backend.device.info, hierarchyBytes: backend.hierarchyBytes }
  } finally { backend?.destroy(); canvas.remove() }
}

for (const distribution of distributions) {
  study(`times three full moving solvers on a million ${distribution} points`, async () => {
    const metadata = await environment()
    for (let round = 0; round < 3; round++) {
      for (let slot = 0; slot < modes.length; slot++) {
        const mode = modes[(round + slot) % modes.length]; const timings: number[] = []
        const name = `timing-${distribution}-${round + 1}-${mode}`
        const base = { ...metadata, distribution, mode, round: round + 1, order: slot + 1 }
        await writeArtifact(name, { ...base, status: 'running' })
        try {
          const result = await movingRun(distribution, mode, timings)
          const samples = timings.slice(3)
          await writeArtifact(name, {
            ...base, ...result, status: 'complete', warmups: timings.slice(0, 3), samples, medianMs: median(samples), p95Ms: percentile(samples, 0.95),
          })
        } catch (error) { await writeArtifact(name, { ...base, timings, error: String(error) }); throw error }
      }
    }
  }, 1200000)
}

function densitySheet (rows: Map<string, LayoutSample[]>, distribution: string): HTMLCanvasElement {
  const plot = document.createElement('canvas'); const tile = 144; const left = 146; const top = 65
  plot.width = left + tile * checkpoints.length + 12; plot.height = top + (tile + 5) * rows.size
  const ctx = plot.getContext('2d')!; ctx.fillStyle = '#20252c'; ctx.fillRect(0, 0, plot.width, plot.height)
  ctx.fillStyle = 'white'; ctx.font = '15px sans-serif'
  ctx.fillText(`Million-point density · ${distribution} · common log count scale and control camera`, 12, 22)
  checkpoints.forEach((tick, i) => ctx.fillText(`Tick ${tick}`, left + i * tile + 40, 49))
  let max = 1
  for (const frames of rows.values()) for (const frame of frames) max = Math.max(max, ...frame.density.subarray(0, bins * bins))
  const mini = document.createElement('canvas'); mini.width = mini.height = bins
  const pixels = mini.getContext('2d')!; const img = pixels.createImageData(bins, bins)
  let row = 0
  for (const [label, frames] of rows) {
    ctx.fillStyle = 'white'; ctx.fillText(label, 12, top + (row + 0.5) * (tile + 5))
    for (const [col, frame] of frames.entries()) {
      for (let i = 0; i < bins * bins; i++) {
        const offset = ((bins - 1 - Math.floor(i / bins)) * bins + i % bins) * 4
        const level = Math.round(255 * Math.log1p(frame.density[i]) / Math.log1p(max))
        img.data.set([level, level, level, 255], offset)
      }
      pixels.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false
      ctx.drawImage(mini, left + col * tile, top + row * (tile + 5), tile - 2, tile - 2)
    }
    row++
  }
  return plot
}

for (const distribution of distributions) {
  study(`checks layouts and coarse grid edges on a million ${distribution} points`, async () => {
    const metadata = await environment()
    await page.viewport(1080, 880)
    const rows = new Map<string, LayoutSample[]>()
    for (const label of ['per-point', 'per-point repeat', 'cell-center', 'four-corners'] as const) {
      const mode = label === 'per-point repeat' ? 'per-point' : label
      const control = rows.get('per-point'); const frames: LayoutSample[] = []
      const result = await movingRun(distribution, mode, [], async (graph, tick) => {
        if (!checkpoints.includes(tick)) return
        frames.push(layoutSample(await graph.readPositions(), tick, control?.[frames.length].box))
      })
      rows.set(label, frames)
      await writeArtifact(`layout-${distribution}-${label.replace(' ', '-')}`, {
        ...metadata,
        ...result,
        distribution,
        label,
        checkpoints: frames.map((frame, i) => ({
          tick: checkpoints[i],
          box: [...frame.box],
          difference: layoutDifference(frame, control?.[i] ?? frame),
          density: [...frame.density],
          sampledXY: [...frame.sample],
        })),
      })
    }
    const sheet = densitySheet(rows, distribution); document.body.append(sheet)
    try { await page.screenshot({ element: sheet, path: `../../../captures/${runId}/density-${distribution}.png` }) } finally { sheet.remove() }

    const fixture = edgeInput(distribution); const device = await createDevice('webgpu')
    try {
      expect(device.info.fallback).toBe(false)
      const reference = await frozenForce(device, fixture.input, 'per-point')
      for (const mode of modes) {
        const { box, forces } = await frozenForce(device, fixture.input, mode)
        expect([...box]).toEqual([...reference.box]); expect(forces.every(Number.isFinite)).toBe(true)
        const edges = edgeDifferences(fixture, box, forces, reference.forces)
        await writeArtifact(`edges-${distribution}-${mode}`, { ...metadata, adapter: device.info, mode, edges, box: [...box] })
      }
    } finally { device.destroy() }
  }, 1200000)
}

for (const distribution of distributions) {
  study(`tracks moving points crossing cells on a million ${distribution} points`, async () => {
    const metadata = await environment()
    const initial = createResidentChain(1026, distribution).input.points
    let control: MotionResult | undefined
    for (const label of ['per-point', 'per-point repeat', 'cell-center', 'four-corners'] as const) {
      const mode = label === 'per-point repeat' ? 'per-point' : label
      const tracker = trackMotion(initial, control?.tracers)
      const run = await movingRun(distribution, mode, [], async (graph, tick) => tracker.add(tick, await graph.readMotionSample(1026)))
      const tracked = tracker.result(); control ??= tracked
      await writeArtifact(`motion-${distribution}-${label.replace(' ', '-')}`, { ...metadata, ...run, distribution, label, ...tracked })
    }
  }, 1200000)
}
