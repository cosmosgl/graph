import { luma } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { COLLISION } from '../collision/data'
import { cool } from '../combined-layout/data'
import { stageDurations } from '../combined-layout/stage-timing'
import { nextFrame } from '../integrated-webgpu/runtime'
import type { Input } from '../many-body/data'
import { createResidentGraph, RESIDENT_FORCE_STAGES, RESIDENT_STAGES } from '../many-body-grid/resident-graph'
import { frameFor } from '../many-body-grid/data'
import { communityDensity, denseFixtureParameters } from './dense-communities'
import { motionChecks, percentile } from './field-metrics'
import { createInteractiveFixture, type InteractiveFixtureKind } from './interactive-fixtures'
import { cameraFromView } from './resident-navigation'

const viewport = { width: 961, height: 541, pixelRatio: 2 }
const warmup = 8
const intervals = 48
const duration = 200
type Resident = Awaited<ReturnType<typeof createResidentGraph>>
type ForceOptions = NonNullable<Parameters<typeof createResidentGraph>[4]>['fullForces']

function fullForces (input: Input): NonNullable<ForceOptions> {
  const count = input.points.length / 4
  const { communityCount, circleRadius } = denseFixtureParameters
  const membership = new Int32Array(count)
  const strengths = new Float32Array(count).fill(1)
  const clusterTargets = new Float32Array(communityCount * 4)
  const pointTargets = new Float32Array(count * 2).fill(NaN)
  const attraction = new Float32Array(count).fill(1)
  for (let group = 1; group < communityCount; group += 2) {
    const angle = group / communityCount * 2 * Math.PI
    clusterTargets.set([circleRadius * Math.cos(angle), circleRadius * Math.sin(angle), 1, 0], group * 4)
  }
  membership.fill(-1, 0, 2)
  for (let id = 2; id < count; id++) {
    const [x, y] = input.points.subarray(id * 4, id * 4 + 2)
    const sector = Math.round(Math.atan2(y, x) / (2 * Math.PI) * communityCount)
    membership[id] = (sector + communityCount) % communityCount
    if (id % 13 === 0) strengths[id] = 0
    if (id % 31 !== 0) continue
    pointTargets.set([x + 7.25, y - 5.5], id * 2)
    if (id % 2 === 0) attraction[id] = -0.25
  }
  return {
    centerStrength: 0.1,
    cluster: { ...input, membership, strengths, targets: clusterTargets },
    attractor: { ...input, strengths: attraction, targets: pointTargets },
    collision: { ...COLLISION, iterations: 2 },
  }
}

function distribution (values: number[]): { medianMs: number; p95Ms: number; maxMs: number } {
  return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: Math.max(...values) }
}

const study = it.skipIf(import.meta.env.VITE_LAB_RESIDENT_FULL_FORCES !== '1')
const cacheComparison = import.meta.env.VITE_LAB_RESIDENT_COLLISION_CACHE === '1'
const lanes: Array<{ count: number; kind: InteractiveFixtureKind; full: boolean; cache?: boolean }> =
  [65536, 262144, 1000000].flatMap(count => (['dense', 'hubs'] as const).map(kind => ({ count, kind, full: true })))
lanes.splice(4, 0, { count: 1000000, kind: 'dense', full: false })
lanes.push({ count: 1000000, kind: 'hubs', full: false })
if (cacheComparison) {
  lanes.splice(6, 0, { count: 1000000, kind: 'dense', full: true, cache: true }, { count: 1000000, kind: 'hubs', full: true, cache: true })
}

for (const { count, kind, full, cache } of lanes) {
  const mode = cache ? 'cached-collision' : full ? 'eight-forces' : 'three-forces'
  study(`runs ${mode} for the ${count}-point resident ${kind} layout`, async () => {
    const host = document.createElement('div')
    host.dataset.residentStudy = 'true'
    const canvas = document.createElement('canvas')
    canvas.dataset.canvas = 'true'
    canvas.width = viewport.width * viewport.pixelRatio
    canvas.height = viewport.height * viewport.pixelRatio
    canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px`
    host.append(canvas); document.body.append(host)
    const frames: Array<{ animation: number; submitMs: number; complete: number }> = []
    const record: Record<string, unknown> = {
      count,
      kind,
      mode,
      frames,
      warmup,
      intervals,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      run: import.meta.env.LAB_RUN_ID,
      luma: luma.VERSION,
      status: 'started',
    }
    const memory = luma.stats.getStats('GPU Time and Memory').get('GPU Memory')
    const baseline = memory.count
    let peak = 0
    const sampleMemory = (): void => { peak = Math.max(peak, memory.count - baseline) }
    let backend: Resident | undefined
    try {
      expect(record.source && record.snapshot && record.run).toBeTruthy()
      expect(navigator.userAgent).not.toContain('HeadlessChrome')
      expect(devicePixelRatio).toBe(viewport.pixelRatio)
      record.windowInfo = await commands.residentInput('layout')
      const { input, graph, metadata } = createInteractiveFixture(count, kind)
      const settings = full ? { ...fullForces(input), cacheCollisionCells: cache } : undefined
      const started = performance.now()
      const resident = await createResidentGraph(canvas, input, graph, 'four-corners', {
        pixelRatio: viewport.pixelRatio,
        picking: true,
        pointCulling: true,
        cachedHighlight: true,
        fullForces: settings,
      })
      backend = resident
      expect(resident.device.info.fallback).toBe(false)
      record.environment = describeEnvironment(resident.device, canvas)
      record.fixture = metadata
      resident.fit()
      resident.redraw()
      await waitForGpu(resident.device, 30000)
      record.startupMs = performance.now() - started
      sampleMemory()
      if (full) resident.setMouseRepulsion({ world: [3196.25, 12.5], strength: 0.2 })
      let alpha = 1
      let tick = 0
      const step = (draw: boolean, timestamps?: Parameters<Resident['frame']>[3]): void => {
        resident.frame(tick++, alpha, draw, timestamps)
        alpha = cool(alpha, duration)
      }
      for (; frames.length < warmup + intervals + 1;) {
        const animation = await nextFrame()
        expect(document.visibilityState).toBe('visible')
        const before = performance.now()
        step(true)
        const submitMs = performance.now() - before
        await waitForGpu(resident.device, 30000)
        frames.push({ animation, submitMs, complete: performance.now() })
        sampleMemory()
      }
      const steady = frames.slice(warmup)
      const frameMs = steady.slice(1).map((frame, i) => frame.animation - steady[i].animation)
      const idleMs = steady.slice(1).map((frame, i) => Math.max(0, frame.animation - steady[i].complete))
      record.timing = { ...distribution(frameMs), within33: frameMs.filter(ms => ms <= 33).length, idleMs: distribution(idleMs) }

      if (resident.device.features.has('timestamp-query')) {
        const stages = full ? [...RESIDENT_STAGES, ...RESIDENT_FORCE_STAGES] : [...RESIDENT_STAGES]
        const samples = 7
        const query = resident.device.createQuerySet({ type: 'timestamp', count: stages.length * samples * 2 })
        try {
          for (let frame = 0; frame < samples; frame++) {
            await nextFrame()
            expect(document.visibilityState).toBe('visible')
            const seen = new Set<string>()
            step(true, stage => {
              const index = stages.indexOf(stage)
              expect(index).toBeGreaterThanOrEqual(0)
              seen.add(stage)
              const first = 2 * (frame * stages.length + index)
              return { timestampQuerySet: query, beginTimestampIndex: first, endTimestampIndex: first + 1 }
            })
            expect(seen.size).toBe(stages.length)
            await waitForGpu(resident.device, 30000)
          }
          const raw = await query.readResults({ firstQuery: 0, queryCount: stages.length * samples * 2 })
          const times = stageDurations(raw, samples * stages.length)
          record.profile = times && Object.fromEntries(stages.map((stage, i) => [
            stage, percentile(Array.from({ length: samples }, (_, frame) => times[frame * stages.length + i]), 0.5),
          ]))
        } finally { query.destroy() }
      } else record.profile = 'unavailable'

      const camera = cameraFromView(await resident.readView(), viewport.height)
      const [pixelX, pixelY] = [
        (viewport.width / 2 - camera.x * camera.zoom) * viewport.pixelRatio,
        (viewport.height / 2 + camera.y * camera.zoom) * viewport.pixelRatio,
      ]
      expect(await resident.pick(pixelX, pixelY)).toBe(0)
      expect(await resident.pick(4, 4)).toBeNull()
      if (full) resident.setMouseRepulsion()
      const coolingTicks = duration - 1 - tick
      for (let i = 0; i < coolingTicks; i++) {
        step(false)
        await waitForGpu(resident.device, 30000)
        expect(document.visibilityState).toBe('visible')
      }
      const previous = await resident.readPositions()
      step(true)
      await waitForGpu(resident.device, 30000)
      const positions = await resident.readPositions()
      const flags = motionChecks(input.points, positions)
      expect(flags).toMatchObject({ nonfinite: 0, flagErrors: 0, fixedMoved: 0 })
      expect(flags.freeMoved).toBeGreaterThan(0)
      const links = await resident.readLinks()
      expect(links.length === graph.links.length && links.every((id, i) => id === graph.links[i])).toBe(true)
      let sum = 0
      for (let i = 0; i < positions.length; i += 4) sum += (positions[i] - previous[i]) ** 2 + (positions[i + 1] - previous[i + 1]) ** 2
      const anchorCount = metadata.pinnedCount - 1
      const density = communityDensity({ input, graph, anchorCount, firstAnchor: count - anchorCount }, positions, frameFor(positions, tick - 1).bounds)
      record.quality = { tick, alpha, flags, density, exactTopology: true, residualRms: Math.sqrt(sum / (count - metadata.absentCount)) }
      record.peakBytes = peak
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally { backend?.destroy(); host.remove(); await writeArtifact(`resident-forces-${count}-${kind}-${mode}`, record) }
  }, 150000)
}
