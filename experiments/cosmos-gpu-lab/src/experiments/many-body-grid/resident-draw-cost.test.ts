import { luma } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, waitForGpu } from '../../gpu/luma'
import { graphRgba } from '../../runtime/palette'
import { writeArtifact } from '../../testing/artifacts'
import { cool } from '../combined-layout/data'
import { stageDurations } from '../combined-layout/stage-timing'
import { createDenseCommunities, type DenseCommunities } from '../million-graph/dense-communities'
import { motionChecks, percentile } from '../million-graph/field-metrics'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'
import { createResidentGraph } from './resident-graph'

const layers = ['clear', 'points', 'links', 'both'] as const
type Layer = typeof layers[number]
const matchedOrders = [
  ['clear', 'points', 'both', 'links'],
  ['points', 'links', 'clear', 'both'],
  ['links', 'both', 'points', 'clear'],
  ['both', 'clear', 'links', 'points'],
] as const
const measuredOrders = Array.from({ length: 4 }, () => matchedOrders).flat(2)
const viewports = [
  { name: 'small', width: 480, height: 340, pixelRatio: 1 },
  { name: 'wide', width: 961, height: 541, pixelRatio: 2 },
] as const
const cameras = ['fit', 'community'] as const
const drawCost = import.meta.env.VITE_LAB_RESIDENT_DRAW_COST === '1'
const renderCandidates = import.meta.env.VITE_LAB_RESIDENT_RENDER_CANDIDATES === '1'
const pointCount = 1000000
const freezeTick = 50
const coolingTicks = 200
type Viewport = typeof viewports[number]
type ResidentGraph = Awaited<ReturnType<typeof createResidentGraph>>
type Sample = { layer: Layer; completionMs: number; submitMs: number; gpuMs: number | null }
type PaintCheck = { clearErrors: number; pointPixels: number; linkPixels: number; visibleLinkPixels: number; compositeErrors: number }

function makeCanvas ({ width, height, pixelRatio }: Viewport): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width * pixelRatio
  canvas.height = height * pixelRatio
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  document.body.append(canvas)
  return canvas
}

function different (a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number): boolean {
  return a[offset] !== b[offset] || a[offset + 1] !== b[offset + 1] || a[offset + 2] !== b[offset + 2] || a[offset + 3] !== b[offset + 3]
}

async function checkPaint (graph: ResidentGraph, canvas: HTMLCanvasElement): Promise<PaintCheck> {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d', { willReadFrequently: true })!
  const capture = async (layer: Layer): Promise<Uint8ClampedArray> => {
    graph.redraw(layer)
    // Capture in the submission task, before the browser retires the swapchain image.
    context.drawImage(canvas, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    await waitForGpu(graph.device, 30000)
    return data
  }
  const clear = await capture('clear')
  const points = await capture('points')
  const links = await capture('links')
  const both = await capture('both')
  const background = graphRgba.background.map(value => Math.round(value * 255))
  const result = { clearErrors: 0, pointPixels: 0, linkPixels: 0, visibleLinkPixels: 0, compositeErrors: 0 }
  for (let offset = 0; offset < clear.length; offset += 4) {
    if (background.some((value, channel) => Math.abs(value - clear[offset + channel]) > 1)) result.clearErrors++
    const point = different(clear, points, offset)
    const link = different(clear, links, offset)
    if (point) result.pointPixels++
    if (link) result.linkPixels++
    if (link && !point) result.visibleLinkPixels++
    if (different(both, point ? points : links, offset)) result.compositeErrors++
  }
  return result
}

function positionBitMismatches (actual: Float32Array, expected: Float32Array): number {
  if (actual.length !== expected.length) throw new Error('Position length changed during draw comparison')
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length)
  const b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length)
  let mismatches = 0
  for (const [i, value] of a.entries()) {
    if (value !== b[i]) mismatches++
  }
  return mismatches
}

async function freeze (fixture: DenseCommunities, visible: () => void): Promise<{ view: number[]; adapter: ResidentGraph['device']['info'] }> {
  const canvas = makeCanvas(viewports[0])
  let graph: ResidentGraph | undefined
  try {
    graph = await createResidentGraph(canvas, fixture.input, fixture.graph, 'four-corners')
    expect(graph.device.info.fallback).toBe(false)
    let alpha = 1
    for (let tick = 0; tick < freezeTick; tick++) {
      visible()
      graph.frame(tick, alpha, tick === freezeTick - 1)
      await waitForGpu(graph.device, 30000)
      alpha = cool(alpha, coolingTicks)
    }
    const frozen = await graph.readPositions()
    const checks = motionChecks(fixture.input.points, frozen)
    expect([checks.nonfinite, checks.flagErrors, checks.fixedMoved]).toEqual([0, 0, 0])
    expect(checks.freeMoved).toBeGreaterThan(0)
    fixture.input.points.set(frozen)
    return { view: Array.from(await graph.readView()), adapter: graph.device.info }
  } finally { graph?.destroy(); canvas.remove() }
}

function summarize (samples: Sample[], layer: Layer): {
  count: number; gpuMedianMs: number | null; gpuP95Ms: number | null; completionMedianMs: number; completionP95Ms: number; submitMedianMs: number;
} {
  const rows = samples.filter(sample => sample.layer === layer)
  const completion = rows.map(sample => sample.completionMs)
  const gpu = rows.map(sample => sample.gpuMs)
  const valid = gpu.every(value => value !== null)
  return {
    count: rows.length,
    gpuMedianMs: valid ? percentile(gpu as number[], 0.5) : null,
    gpuP95Ms: valid ? percentile(gpu as number[], 0.95) : null,
    completionMedianMs: percentile(completion, 0.5),
    completionP95Ms: percentile(completion, 0.95),
    submitMedianMs: percentile(rows.map(sample => sample.submitMs), 0.5),
  }
}

it.skipIf(!drawCost || renderCandidates)('separates frozen million-point drawing costs on visible native Chrome', async () => {
  const runId: string = import.meta.env.LAB_RUN_ID
  const source: string = import.meta.env.LAB_SOURCE_REVISION
  const snapshot: string = import.meta.env.LAB_SOURCE_SNAPSHOT
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId) || !source || !snapshot) throw new Error('Record the source revision and a fresh snapshot capture')
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const visible = (): void => {
    if (hidden || document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) {
      throw new Error('Keep the native Chrome benchmark continuously visible')
    }
  }
  document.addEventListener('visibilitychange', visibility)
  try {
    visible()
    const webgl = await createDevice('webgl', document.createElement('canvas'), false)
    const webglInfo = webgl.info
    webgl.destroy()
    const fixture = createDenseCommunities(pointCount)
    const base = {
      runId,
      source,
      snapshot,
      luma: luma.VERSION,
      browser: navigator.userAgent,
      browserDpr: window.devicePixelRatio,
      webgl: webglInfo,
      pointCount,
      links: fixture.graph.links.length / 2,
      seed: 29471,
      freezeTick,
      coolingTicks,
    }
    await writeArtifact('draw-cost-freeze', { ...base, status: 'running' })
    const frozen = await freeze(fixture, visible).catch(async error => {
      await writeArtifact('draw-cost-freeze', { ...base, status: 'failed', error: String(error) })
      throw error
    })
    await writeArtifact('draw-cost-freeze', { ...base, ...frozen, status: 'complete' })
    const failures: string[] = []
    for (const viewport of viewports) {
      const canvas = makeCanvas(viewport)
      let graph: ResidentGraph | undefined
      try {
        graph = await createResidentGraph(canvas, fixture.input, fixture.graph, 'four-corners', { pixelRatio: viewport.pixelRatio })
        expect(graph.device.info.fallback).toBe(false)
        const { left, top, right, bottom, width, height } = canvas.getBoundingClientRect()
        expect([width, height]).toEqual([viewport.width, viewport.height])
        expect(left >= 0 && top >= 0 && right <= window.innerWidth && bottom <= window.innerHeight).toBe(true)
        const renderContext = {
          ...base,
          viewport,
          css: [width, height],
          backing: [canvas.width, canvas.height],
          browserViewport: [window.innerWidth, window.innerHeight],
          adapter: graph.device.info,
          fitView: frozen.view,
        }
        const [minX, minY, side] = frozen.view
        const zoom = viewport.height / (side * 1.1)
        for (const name of cameras) {
          const artifact = `draw-cost-${viewport.name}-${name}`
          const camera = name === 'fit' ? { x: minX + side / 2, y: minY + side / 2, zoom } : { x: 3200, y: 0, zoom: zoom * 3 }
          const samples: Sample[] = []
          const query = graph.device.features.has('timestamp-query')
            ? graph.device.createQuerySet({ type: 'timestamp', count: measuredOrders.length * 2 })
            : undefined
          try {
            graph.setCamera(camera)
            await waitForGpu(graph.device, 30000)
            const viewBefore = Array.from(await graph.readView())
            for (const layer of layers) {
              graph.redraw(layer)
              await waitForGpu(graph.device, 30000)
            }
            for (const [i, layer] of measuredOrders.entries()) {
              visible()
              const timestamps = query ? { timestampQuerySet: query, beginTimestampIndex: 2 * i, endTimestampIndex: 2 * i + 1 } : undefined
              const started = performance.now()
              graph.redraw(layer, timestamps)
              const submitted = performance.now()
              await waitForGpu(graph.device, 30000)
              samples.push({ layer, completionMs: performance.now() - started, submitMs: submitted - started, gpuMs: null })
              visible()
            }
            let timer: TimerStatus = 'unavailable'
            if (query) {
              const result = await readLumaTimer({
                async readTimestampDuration (): Promise<number> {
                  const stamps = await query.readResults({ firstQuery: 0, queryCount: measuredOrders.length * 2 })
                  const durations = stageDurations(stamps, measuredOrders.length)
                  if (!durations) return NaN
                  durations.forEach((duration, i) => { samples[i].gpuMs = duration })
                  return durations.reduce((sum, duration) => sum + duration, 0)
                },
              })
              timer = result.status
            }
            const paint = await checkPaint(graph, canvas)
            const positionMismatches = positionBitMismatches(await graph.readPositions(), fixture.input.points)
            const viewAfter = Array.from(await graph.readView())
            const summary = Object.fromEntries(layers.map(layer => [layer, summarize(samples, layer)]))
            await writeArtifact(artifact, {
              ...renderContext, status: 'complete', camera, viewBefore, viewAfter, timer, paint, positionMismatches, samples, summary,
            })
            expect(positionMismatches).toBe(0)
            expect(viewAfter).toEqual(viewBefore)
            expect(paint.clearErrors).toBe(0)
            expect(paint.pointPixels).toBeGreaterThan(0)
            expect(paint.linkPixels).toBeGreaterThan(0)
            expect(paint.compositeErrors).toBe(0)
            expect(timer).toBe('valid')
          } catch (error) {
            failures.push(`${artifact} ${String(error)}`)
            await writeArtifact(`${artifact}-failure`, { ...renderContext, status: 'failed', camera, samples, error: String(error) })
          } finally { query?.destroy() }
        }
      } catch (error) {
        failures.push(`${viewport.name} ${String(error)}`)
        await writeArtifact(`draw-cost-${viewport.name}-setup-failure`, { ...base, status: 'failed', viewport, error: String(error) })
      } finally { graph?.destroy(); canvas.remove() }
    }
    expect(failures).toEqual([])
  } finally { document.removeEventListener('visibilitychange', visibility) }
}, 180000)

type DrawVariant = { variant: string; pointCulling?: boolean; cachedHighlight?: boolean }
const drawVariants: DrawVariant[] = [
  { variant: 'point-culling', pointCulling: true },
  { variant: 'cached-highlight', cachedHighlight: true },
  { variant: 'combined', pointCulling: true, cachedHighlight: true },
]
type ProbePixel = [x: number, y: number]
type FrozenDrawCheck = {
  points: Uint8ClampedArray;
  scene: Uint8ClampedArray;
  highlights: Uint8ClampedArray[];
  probes: ProbePixel[];
  picks: Array<number | null>;
  selectedIds: Array<number | null>;
  cachedUpdates: boolean[];
}

// Choose pixels from the direct renderer, including background and a mix of
// visible pinned and ordinary points. Keep those coordinates for every lane.
function pickProbes (scene: Uint8ClampedArray, width: number, height: number): ProbePixel[] {
  const probes: ProbePixel[] = [[0, 0]]
  for (const color of [graphRgba.point, graphRgba.pinned]) {
    const bytes = color.map(channel => Math.round(channel * 255))
    let chosen = 0
    for (let y = 2; y < height - 2 && chosen < 4; y += 3) {
      for (let x = 2; x < width - 2 && chosen < 4; x += 3) {
        const offset = (y * width + x) * 4
        if (!bytes.every((value, channel) => scene[offset + channel] === value)) continue
        if (probes.some(([px, py]) => Math.hypot(x - px, y - py) <= 12)) continue
        probes.push([x, y]); chosen++
      }
    }
  }
  return probes
}

async function checkFrozenDraw (graph: ResidentGraph, canvas: HTMLCanvasElement, reference: FrozenDrawCheck | undefined): Promise<FrozenDrawCheck> {
  const copy = document.createElement('canvas')
  copy.width = canvas.width; copy.height = canvas.height
  const context = copy.getContext('2d', { willReadFrequently: true })!
  const capture = (): Uint8ClampedArray => {
    context.drawImage(canvas, 0, 0)
    return context.getImageData(0, 0, copy.width, copy.height).data
  }
  graph.select(null)
  graph.redraw('points')
  const points = capture()
  await waitForGpu(graph.device, 30000)
  graph.redraw()
  const scene = capture()
  await waitForGpu(graph.device, 30000)
  const probes = reference?.probes ?? pickProbes(scene, canvas.width, canvas.height)
  const picks: Array<number | null> = []
  for (const [x, y] of probes) picks.push(await graph.pick(x, y))
  const firstTwo = [...new Set(picks.filter(id => id !== null))].slice(0, 2)
  const selectedIds = reference?.selectedIds ?? [...firstTwo, null]
  const highlights: Uint8ClampedArray[] = []
  const cachedUpdates: boolean[] = []
  for (const id of selectedIds) {
    graph.select(id)
    cachedUpdates.push(graph.redrawHighlight())
    highlights.push(capture())
    await waitForGpu(graph.device, 30000)
  }
  return { points, scene, highlights, probes, picks, selectedIds, cachedUpdates }
}

function wrongPixels (expected: Uint8ClampedArray, actual: Uint8ClampedArray): number {
  let mismatches = 0
  for (let offset = 0; offset < expected.length; offset += 4) if (different(expected, actual, offset)) mismatches++
  return mismatches
}

type DrawSample = { operation: 'points' | 'both' | 'highlight'; completionMs: number; submitMs: number; cached?: boolean }

async function measureFrozenDraw (
  graph: ResidentGraph, selectedIds: Array<number | null>, samples: DrawSample[], visible: () => void
): Promise<void> {
  const measure = async (operation: DrawSample['operation'], draw: () => boolean | void): Promise<void> => {
    visible()
    const started = performance.now()
    const cached = draw()
    const submitted = performance.now()
    await waitForGpu(graph.device, 30000)
    const completionMs = performance.now() - started
    samples.push({ operation, completionMs, submitMs: submitted - started, ...(typeof cached === 'boolean' ? { cached } : {}) })
    visible()
  }
  graph.select(null)
  for (const layer of ['points', 'both'] as const) {
    graph.redraw(layer)
    await waitForGpu(graph.device, 30000)
  }
  for (let sample = 0; sample < 16; sample++) {
    const order = sample % 2 ? ['both', 'points'] as const : ['points', 'both'] as const
    for (const layer of order) await measure(layer, () => { graph.redraw(layer) })
  }
  // Start from a complete render. Selection changes are included in the
  // timed path, while pixel/ID readback happens outside the timed window.
  graph.redraw()
  await waitForGpu(graph.device, 30000)
  for (let sample = 0; sample < 16; sample++) {
    await measure('highlight', () => {
      graph.select(selectedIds[sample % selectedIds.length])
      return graph.redrawHighlight()
    })
  }
}

it.skipIf(!drawCost || !renderCandidates)('compares frozen million-point draw and highlight candidates', async () => {
  const runId: string = import.meta.env.LAB_RUN_ID
  const source: string = import.meta.env.LAB_SOURCE_REVISION
  const snapshot: string = import.meta.env.LAB_SOURCE_SNAPSHOT
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId) || !source || !snapshot) throw new Error('Record the source revision and a fresh snapshot capture')
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const visible = (): void => {
    if (hidden || document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) {
      throw new Error('Keep the native Chrome benchmark continuously visible')
    }
  }
  document.addEventListener('visibilitychange', visibility)
  try {
    visible()
    const webgl = await createDevice('webgl', document.createElement('canvas'), false)
    const webglInfo = webgl.info
    webgl.destroy()
    const fixture = createDenseCommunities(pointCount)
    const base = {
      runId,
      source,
      snapshot,
      luma: luma.VERSION,
      browser: navigator.userAgent,
      browserDpr: window.devicePixelRatio,
      webgl: webglInfo,
      pointCount,
      links: fixture.graph.links.length / 2,
      seed: 29471,
      freezeTick,
      coolingTicks,
      timing: 'Performance clock before submission through the GPU fence for the complete operation',
    }
    await writeArtifact('render-candidates-freeze', { ...base, status: 'running' })
    const frozen = await freeze(fixture, visible).catch(async error => {
      await writeArtifact('render-candidates-freeze', { ...base, status: 'failed', error: String(error) })
      throw error
    })
    await writeArtifact('render-candidates-freeze', { ...base, ...frozen, status: 'complete' })
    const failures: string[] = []
    for (const viewport of viewports) {
      const references = new Map<typeof cameras[number], FrozenDrawCheck>()
      const order = [
        { variant: 'baseline' },
        ...(viewport.name === 'small' ? drawVariants : [...drawVariants].reverse()),
        { variant: 'baseline-repeat' },
      ]
      for (const { variant, ...options } of order) {
        const canvas = makeCanvas(viewport)
        let graph: ResidentGraph | undefined
        try {
          graph = await createResidentGraph(canvas, fixture.input, fixture.graph, 'four-corners', {
            ...options, pixelRatio: viewport.pixelRatio, picking: true,
          })
          expect(graph.device.info.fallback).toBe(false)
          const { left, top, right, bottom, width, height } = canvas.getBoundingClientRect()
          expect([width, height]).toEqual([viewport.width, viewport.height])
          expect(left >= 0 && top >= 0 && right <= window.innerWidth && bottom <= window.innerHeight).toBe(true)
          const [minX, minY, side] = frozen.view
          const zoom = viewport.height / (side * 1.1)
          const context = {
            ...base,
            viewport,
            variant,
            options,
            adapter: graph.device.info,
            fitView: frozen.view,
            css: [width, height],
            backing: [canvas.width, canvas.height],
            browserViewport: [window.innerWidth, window.innerHeight],
          }
          for (const name of cameras) {
            const artifact = `render-candidates-${viewport.name}-${name}-${variant}`
            const camera = name === 'fit' ? { x: minX + side / 2, y: minY + side / 2, zoom } : { x: 3200, y: 0, zoom: zoom * 3 }
            const record: Record<string, unknown> = { ...context, camera, status: 'started' }
            try {
              graph.setCamera(camera)
              await waitForGpu(graph.device, 30000)
              const viewBefore = Array.from(await graph.readView())
              const reference = references.get(name)
              const actual = await checkFrozenDraw(graph, canvas, reference)
              const drawnPoints = await graph.readDrawnPointCount()
              const expected = reference ?? actual
              const pixelMismatches = {
                points: wrongPixels(expected.points, actual.points),
                scene: wrongPixels(expected.scene, actual.scene),
                highlights: actual.highlights.map((frame, i) => wrongPixels(expected.highlights[i], frame)),
              }
              Object.assign(record, {
                viewBefore,
                drawnPoints,
                pixelMismatches,
                probes: actual.probes,
                picks: actual.picks,
                selectedIds: actual.selectedIds,
                cachedUpdates: actual.cachedUpdates,
              })
              const samples: DrawSample[] = []
              record.samples = samples
              await measureFrozenDraw(graph, actual.selectedIds, samples, visible)
              const positionMismatches = positionBitMismatches(await graph.readPositions(), fixture.input.points)
              const viewAfter = Array.from(await graph.readView())
              Object.assign(record, { viewAfter, positionMismatches })
              record.summary = Object.fromEntries((['points', 'both', 'highlight'] as const).map(operation => {
                const rows = samples.filter(sample => sample.operation === operation)
                return [operation, {
                  count: rows.length,
                  medianMs: percentile(rows.map(sample => sample.completionMs), 0.5),
                  p95Ms: percentile(rows.map(sample => sample.completionMs), 0.95),
                }]
              }))
              expect(reference !== undefined || variant === 'baseline').toBe(true)
              expect(pixelMismatches).toEqual({ points: 0, scene: 0, highlights: actual.highlights.map(() => 0) })
              expect(actual.picks).toEqual(expected.picks)
              expect(actual.picks[0]).toBeNull()
              expect(actual.selectedIds).toHaveLength(3)
              expect(wrongPixels(actual.scene, actual.highlights[0])).toBeGreaterThan(0)
              expect(wrongPixels(actual.highlights[0], actual.highlights[1])).toBeGreaterThan(0)
              expect(wrongPixels(actual.scene, actual.highlights[2])).toBe(0)
              expect(actual.cachedUpdates.every(cached => cached === !!options.cachedHighlight)).toBe(true)
              expect(samples.filter(sample => sample.operation === 'highlight').every(sample => sample.cached === !!options.cachedHighlight)).toBe(true)
              expect(positionMismatches).toBe(0)
              expect(viewAfter).toEqual(viewBefore)
              expect(drawnPoints).toBeGreaterThan(0)
              if (options.pointCulling && name === 'fit') expect(drawnPoints).toBeLessThan(pointCount - 1)
              if (variant === 'baseline') references.set(name, actual)
              record.status = 'complete'
            } catch (error) {
              failures.push(`${artifact} ${String(error)}`)
              record.status = 'failed'; record.error = String(error)
            } finally { await writeArtifact(artifact, record) }
          }
        } catch (error) {
          const artifact = `render-candidates-${viewport.name}-${variant}-setup-failure`
          failures.push(`${artifact} ${String(error)}`)
          await writeArtifact(artifact, { ...base, status: 'failed', viewport, variant, options, error: String(error) })
        } finally { graph?.destroy(); canvas.remove() }
      }
    }
    expect(failures).toEqual([])
  } finally { document.removeEventListener('visibilitychange', visibility) }
}, 240000)
