import { luma, type QuerySet } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { waitForGpu } from '../../gpu/luma'
import { graphRgba } from '../../runtime/palette'
import { writeArtifact } from '../../testing/artifacts'
import { stageDurations } from '../combined-layout/stage-timing'
import { RESIDENT_STAGES, type createResidentGraph, type ResidentStageTimestamps } from '../many-body-grid/resident-graph'
import type { TimestampWrites } from '../many-body/timing'
import { readLumaTimer } from '../weighted-links/timing'
import { motionChecks, percentile } from './field-metrics'
import { createInteractiveFixture, type InteractiveFixtureKind } from './interactive-fixtures'
import { cameraFromView, type ResidentCamera } from './resident-navigation'
import { createMillionGraphView, type MovingFrame, type PickFeedback } from './view'

type ScreenPoint = [number, number]
type WindowInfo = { bounds: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number } }
type Variant = 'baseline' | 'combined' | 'fenced' | 'ahead' | 'depth' | 'deep-field'
declare module 'vitest/browser' {
  interface BrowserCommands {
    residentInput(action: 'layout'): Promise<WindowInfo>;
    residentInput(action: 'pick' | 'zoom', from: ScreenPoint): Promise<void>;
    residentInput(action: 'pan', from: ScreenPoint, to: ScreenPoint): Promise<void>;
  }
}

const viewport = { width: 961, height: 541, pixelRatio: 2 }
const frameTarget = 33
const pickTarget = 50
const warmup = 8
const intervals = 48
const expectedPoint = [0, 0, 1, 0]
const renderCandidates = import.meta.env.VITE_LAB_RESIDENT_RENDER_CANDIDATES === '1'
const framePacing = import.meta.env.VITE_LAB_RESIDENT_FRAME_PACING === '1'
const depthCandidates = import.meta.env.VITE_LAB_RESIDENT_DEPTH_LINKS === '1'
const deepField = import.meta.env.VITE_LAB_RESIDENT_DEEP_FIELD === '1'
const frameStudy = framePacing || depthCandidates || deepField
const profile = frameStudy && import.meta.env.VITE_LAB_RESIDENT_FRAME_PROFILE === '1'
const querySamples = (intervals + 1) * RESIDENT_STAGES.length
const cases: Array<[number, InteractiveFixtureKind]> = [
  [65536, 'dense'], [65536, 'hubs'],
  [131072, 'hubs'], [131072, 'dense'],
  [196608, 'dense'], [196608, 'hubs'],
  [262144, 'hubs'], [262144, 'dense'],
  [393216, 'dense'], [393216, 'hubs'],
  [524288, 'hubs'], [524288, 'dense'],
  [786432, 'dense'], [786432, 'hubs'],
  [1000000, 'dense'], [1000000, 'hubs'],
]
const renderCases: Array<[number, InteractiveFixtureKind, Variant]> = cases.map(([count, kind]) => [count, kind, 'baseline'])
if (frameStudy) {
  const pacingVariant = depthCandidates ? 'depth' : 'ahead'
  const variant = deepField ? 'deep-field' : pacingVariant
  renderCases.splice(0, renderCases.length,
    [1000000, 'dense', 'fenced'], [1000000, 'dense', variant],
    [1000000, 'hubs', variant], [1000000, 'hubs', 'fenced'])
} else if (renderCandidates) {
  renderCases.splice(0, renderCases.length,
    [1000000, 'dense', 'baseline'], [1000000, 'dense', 'combined'],
    [1000000, 'hubs', 'combined'], [1000000, 'hubs', 'baseline'])
}

function allocation (): { buffer: number; texture: number; total: number } {
  const stats = luma.stats.getStats('GPU Time and Memory')
  return { buffer: stats.get('Buffer Memory').count, texture: stats.get('Texture Memory').count, total: stats.get('GPU Memory').count }
}

function describeTimes (samples: number[], budget: number): { count: number; median: number; p95: number; max: number; within: number } {
  return {
    count: samples.length,
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
    within: samples.filter(sample => sample <= budget).length,
  }
}

function frameIntervals (frames: MovingFrame[]): number[] {
  return frames.slice(1).map((frame, i) => frame.animationTime - frames[i].animationTime)
}

function screenOrigin ({ x, y, zoom }: ResidentCamera): ScreenPoint {
  return [viewport.width / 2 - x * zoom, viewport.height / 2 + y * zoom]
}

function paintedPoint (canvas: HTMLCanvasElement, point: ScreenPoint): number[] {
  const pixel = document.createElement('canvas')
  pixel.width = 1; pixel.height = 1
  const context = pixel.getContext('2d')!
  context.drawImage(canvas, Math.floor(point[0] * viewport.pixelRatio), Math.floor(point[1] * viewport.pixelRatio), 1, 1, 0, 0, 1, 1)
  return Array.from(context.getImageData(0, 0, 1, 1).data)
}

for (const [count, kind, variant] of renderCases) {
  const lane = renderCandidates || frameStudy ? `-${variant}${profile ? '-profile' : ''}` : ''
  const candidate = variant !== 'baseline'
  it.skipIf(import.meta.env.VITE_LAB_RESIDENT_INTERACTION !== '1')(`measures a moving ${count}-point ${kind}${lane} viewer`, async () => {
    const frames: MovingFrame[] = []
    const picks: PickFeedback[] = []
    const callbacks: Array<{ animationTime: number; started: number; busy: boolean }> = []
    let hidden = document.visibilityState !== 'visible'
    const recordVisibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
    document.addEventListener('visibilitychange', recordVisibility)
    const baseline = allocation()
    const peak = { buffer: 0, texture: 0, total: 0 }
    const sampleMemory = (): void => {
      const used = allocation()
      peak.buffer = Math.max(peak.buffer, used.buffer - baseline.buffer)
      peak.texture = Math.max(peak.texture, used.texture - baseline.texture)
      peak.total = Math.max(peak.total, used.total - baseline.total)
    }
    const host = document.createElement('div')
    host.dataset.residentStudy = 'true'
    document.body.append(host)
    const record: Record<string, unknown> = {
      count,
      kind,
      frames,
      picks,
      baseline,
      peak,
      warmup,
      intervals,
      variant,
      profile,
      frameTarget,
      pickTarget,
      status: 'started',
      luma: luma.VERSION,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      run: import.meta.env.LAB_RUN_ID,
      browser: navigator.userAgent,
    }
    let backend: Awaited<ReturnType<typeof createResidentGraph>> | undefined
    let initialPositions: Float32Array | undefined
    let query: QuerySet | undefined
    let readyAt = 0
    let fail = ''
    let notify = (): void => {}
    async function until (check: () => boolean, label: string): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { notify = (): void => {}; reject(new Error(`Timed out waiting for ${label}`)) }, 25000)
        notify = (): void => {
          if (!fail && !check()) return
          clearTimeout(timeout); notify = (): void => {}
          if (fail) reject(new Error(fail))
          else resolve()
        }
        notify()
      })
    }
    const view = await createMillionGraphView(host, {
      viewport,
      pointCulling: candidate,
      cachedHighlight: candidate,
      depthLinks: variant === 'depth',
      coarseLevels: variant === 'deep-field' ? 6 : undefined,
      scheduleAhead: variant === 'ahead',
      callback: frameStudy ? (animationTime, busy): void => { callbacks.push({ animationTime, started: performance.now(), busy }) } : undefined,
      timestamps: profile
        ? (tick): ResidentStageTimestamps | undefined => {
          if (!query || tick < warmup || tick > warmup + intervals) return undefined
          return (stage): TimestampWrites => {
            const idx = 2 * ((tick - warmup) * RESIDENT_STAGES.length + RESIDENT_STAGES.indexOf(stage))
            return { timestampQuerySet: query, beginTimestampIndex: idx, endTimestampIndex: idx + 1 }
          }
        }
        : undefined,
      ready (graph, positions, metadata): void {
        readyAt = performance.now()
        if (profile && graph.device.features.has('timestamp-query')) {
          query = graph.device.createQuerySet({ type: 'timestamp', count: querySamples * 2 })
        }
        backend = graph; initialPositions = positions; record.fixture = metadata
        sampleMemory(); notify()
      },
      submitted: sampleMemory,
      frame (frame): void { frames.push(frame); notify() },
      feedback (feedback): void { picks.push(feedback); notify() },
      failed (error): void { fail = error; notify() },
    })
    try {
      expect(record.source && record.snapshot && record.run).toBeTruthy()
      expect(hidden).toBe(false)
      expect(navigator.userAgent).not.toContain('HeadlessChrome')
      expect(devicePixelRatio).toBe(viewport.pixelRatio)
      const canvas = host.querySelector<HTMLCanvasElement>('[data-canvas]')!
      const setting = (name: string, value: string): void => {
        const control = host.querySelector<HTMLSelectElement>(`[data-${name}]`)!
        control.value = value
        control.dispatchEvent(new Event('change'))
      }
      setting('count', String(count))
      setting('distribution', kind === 'dense' ? 'persistent-communities' : 'hubs')
      setting('force', 'four-corners')
      const windowInfo = await commands.residentInput('layout')
      record.windowInfo = windowInfo
      expect(windowInfo.bounds.width).toBe(viewport.width)
      expect(windowInfo.bounds.height).toBe(viewport.height)
      expect([canvas.width, canvas.height]).toEqual([1922, 1082])
      const replacement = frameStudy ? createInteractiveFixture(count, kind).graph : undefined
      const start = performance.now()
      host.querySelector<HTMLButtonElement>('[data-play]')!.click()
      await until(() => !!backend, 'resident graph startup')
      const graph = backend!
      expect(record.fixture).toMatchObject({ kind, pointCount: count, linkCount: count - 10 })
      record.environment = describeEnvironment(graph.device, canvas)
      expect(graph.device.info.fallback).toBe(false)
      await until(() => frames.length >= warmup + intervals + 1, 'the normal timing window')
      const steady = frames.slice(warmup, warmup + intervals + 1)
      const normal = describeTimes(frameIntervals(steady), frameTarget)
      record.normal = normal
      record.synchronizedTicks = describeTimes(steady.map(frame => frame.completed - frame.started), frameTarget)
      if (frameStudy) {
        record.callbacks = callbacks
        record.steadyWork = {
          submit: describeTimes(steady.map(frame => frame.submitted - frame.started), frameTarget),
          fence: describeTimes(steady.map(frame => frame.completed - frame.submitted), frameTarget),
          betweenUpdates: describeTimes(steady.slice(1).map((frame, i) => frame.started - steady[i].completed), frameTarget),
          busyCallbacks: callbacks.filter(({ animationTime, busy }) => busy &&
            animationTime >= steady[0].animationTime && animationTime <= steady.at(-1)!.animationTime).length,
        }
        record.startup = { readyMs: readyAt - start, firstSynchronizedFrameMs: frames[0].completed - start, topologyMs: graph.topologyMs }
      }
      const interactionStart = frames.length - 1

      await commands.residentInput('pan', [300, 180], [360, 205])
      const firstPanEnd = performance.now()
      await until(() => !!frames.at(-1)?.camera && frames.at(-1)!.started >= firstPanEnd, 'the first pan')
      const manual = frames.at(-1)!.camera!
      // Once the GPU fit stops following the positions, the next pan has an
      // exact manual-camera reference.
      await commands.residentInput('pan', [300, 180], [320, 165])
      await until(() => frames.at(-1)!.camera!.x < manual.x, 'the second pan')
      const panned = frames.at(-1)!.camera!
      // Wait for all three native pointer moves to be applied.
      await until(() => Math.abs((manual.x - frames.at(-1)!.camera!.x) * manual.zoom - 20) < 1, 'the complete pan')
      const afterPan = frames.at(-1)!.camera!
      expect(Math.abs((afterPan.y - manual.y) * manual.zoom + 15)).toBeLessThan(1)
      const panOrigin = screenOrigin(afterPan)
      record.pan = { from: manual, intermediate: panned, to: afterPan }
      await commands.residentInput('zoom', panOrigin)
      await until(() => frames.at(-1)!.camera!.zoom > manual.zoom, 'the wheel zoom')
      const afterZoom = frames.at(-1)!.camera!
      const origin = screenOrigin(cameraFromView(await graph.readView(), viewport.height))
      expect(Math.hypot(origin[0] - panOrigin[0], origin[1] - panOrigin[1])).toBeLessThan(1)
      record.zoom = { from: afterPan, to: afterZoom, origin }

      const expectedIds = [null, 0, null, 0, null, 0, null, 0]
      for (const [i, expected] of expectedIds.entries()) {
        const point: ScreenPoint = expected === null ? [origin[0] + 18, origin[1] + 18] : origin
        await commands.residentInput('pick', point)
        await until(() => picks.length > i, `pick ${i + 1}`)
        await until(() => frames.at(-1)!.tick > picks[i].tick, `movement after pick ${i + 1}`)
      }
      const picking = describeTimes(picks.map(pick => pick.milliseconds), pickTarget)
      const duringInteraction = describeTimes(frameIntervals(frames.slice(interactionStart)), frameTarget)
      record.picking = picking
      record.duringInteraction = duringInteraction
      record.timingReferences = {
        steady: normal.within >= normal.count * 0.95,
        duringInteraction: duringInteraction.within >= duringInteraction.count * 0.95,
        picking: picking.within === picking.count,
      }
      expect(picks.map(pick => pick.id)).toEqual(expectedIds)
      expect(picks.every(pick => pick.running && pick.trusted)).toBe(true)
      if (candidate) expect(picks.every(pick => pick.cachedHighlight === true)).toBe(true)
      expect(hidden).toBe(false)

      if (replacement) {
        const links = replacement.links.subarray(0, -2)
        const weights = replacement.weights.subarray(0, -1)
        const updated = performance.now()
        graph.updateLinks({ links, weights, sizes: replacement.sizes })
        const submitted = performance.now()
        expect(graph.linkCount).toBe(count - 11)
        await until(() => frames.at(-1)!.started >= submitted, 'the first updated frame')
        const rendered = frames.at(-1)!
        await new Promise(resolve => requestAnimationFrame(resolve))
        record.update = {
          linkCount: graph.linkCount,
          topologyMs: graph.topologyMs,
          callMs: submitted - updated,
          frameMs: rendered.completed - updated,
          feedbackMs: performance.now() - updated,
        }
      }

      host.querySelector<HTMLButtonElement>('[data-pause]')!.click()
      await waitForGpu(graph.device, 30000)
      if (candidate) expect(graph.redrawHighlight()).toBe(true)
      else graph.redraw()
      const highlight = paintedPoint(canvas, origin)
      expect(highlight).toEqual(graphRgba.coral.map(channel => Math.round(channel * 255)))
      record.highlight = highlight
      const final = await graph.readPositions()
      const motion = motionChecks(initialPositions!, final)
      expect([motion.nonfinite, motion.flagErrors, motion.fixedMoved]).toEqual([0, 0, 0])
      expect(motion.freeMoved).toBeGreaterThan(0)
      expect(Array.from(final.subarray(0, 4))).toEqual(expectedPoint)
      record.motion = motion
      if (profile) {
        const measurements: { durations: number[] | null } = { durations: null }
        const timer = query
          ? await readLumaTimer({
            async readTimestampDuration (): Promise<number> {
              measurements.durations = stageDurations(await query!.readResults({ firstQuery: 0, queryCount: querySamples * 2 }), querySamples)
              return measurements.durations?.reduce((total, duration) => total + duration, 0) ?? NaN
            },
          })
          : { status: 'unavailable' }
        const valid = timer.status === 'valid' ? measurements.durations : null
        const rows = valid ? steady.map((_, i) => valid.slice(i * RESIDENT_STAGES.length, (i + 1) * RESIDENT_STAGES.length)) : null
        record.gpuTiming = { status: timer.status, stages: RESIDENT_STAGES, rows }
      }
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally {
      document.removeEventListener('visibilitychange', recordVisibility)
      query?.destroy()
      view.destroy()
      host.remove()
      await writeArtifact(`resident-interaction-${count}-${kind}${lane}`, record)
    }
  }, 120000)
}
