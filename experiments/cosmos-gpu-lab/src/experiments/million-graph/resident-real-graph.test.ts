import { luma } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import type { createResidentGraph } from '../many-body-grid/resident-graph'
import { motionChecks, percentile } from './field-metrics'
import { createMillionGraphView, type MovingFrame } from './view'
import { loadYoutubeFixture, youtubeFixtureHash } from './youtube-fixture'

const viewport = { width: 961, height: 541, pixelRatio: 2 }
const pointCount = 1000000
const linkCount = 2852734
const warmup = 8
const intervals = 48

it.skipIf(import.meta.env.VITE_LAB_RESIDENT_REAL_GRAPH !== '1')('measures the moving million-point YouTube graph', async () => {
  const frames: MovingFrame[] = []
  const record: Record<string, unknown> = {
    fixtureSha256: youtubeFixtureHash,
    pointCount,
    linkCount,
    warmup,
    intervals,
    frames,
    viewport,
    source: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    run: import.meta.env.LAB_RUN_ID,
    browser: navigator.userAgent,
    luma: luma.VERSION,
    status: 'started',
  }
  const host = document.createElement('div')
  host.dataset.residentStudy = 'true'
  document.body.append(host)
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  document.addEventListener('visibilitychange', visibility)
  let view: Awaited<ReturnType<typeof createMillionGraphView>> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    expect(record.source && record.snapshot && record.run).toBeTruthy()
    expect(navigator.userAgent).not.toContain('HeadlessChrome')
    expect(devicePixelRatio).toBe(viewport.pixelRatio)
    expect(hidden).toBe(false)
    const fixture = await loadYoutubeFixture()
    const memory = luma.stats.getStats('GPU Time and Memory').get('GPU Memory')
    const baseline = memory.count
    let peak = 0
    let start = 0
    let failure = ''
    let active: Awaited<ReturnType<typeof createResidentGraph>> | undefined
    let finish = (): void => {}
    const measured = new Promise<void>(resolve => { finish = resolve })
    view = await createMillionGraphView(host, {
      fixture,
      viewport,
      pointCulling: true,
      cachedHighlight: true,
      ready (graph): void {
        active = graph
        record.readyMs = performance.now() - start
        record.topologyMs = graph.topologyMs
        record.environment = describeEnvironment(graph.device, host.querySelector<HTMLCanvasElement>('[data-canvas]')!)
        peak = Math.max(peak, memory.count - baseline)
      },
      frame (frame): void { frames.push(frame); if (frames.length >= warmup + intervals + 1) finish() },
      submitted (): void { peak = Math.max(peak, memory.count - baseline) },
      feedback (): void {},
      failed (error): void { failure = error; finish() },
    }, { points: pointCount, distribution: 'uniform', force: 'four-corners' })
    record.windowInfo = await commands.residentInput('layout')
    start = performance.now()
    timeout = setTimeout(finish, 45000)
    host.querySelector<HTMLButtonElement>('[data-play]')!.click()
    await measured
    view.pause?.()
    record.firstSynchronizedFrameMs = frames.length ? frames[0].completed - start : null
    record.peakBytes = peak
    record.hidden = hidden
    record.timedOut = !failure && frames.length < warmup + intervals + 1
    if (failure) throw new Error(failure)
    const steady = frames.slice(warmup, warmup + intervals + 1)
    const timings = steady.slice(1).map((frame, i) => frame.animationTime - steady[i].animationTime)
    record.steady = timings.length ? { count: timings.length, p95: percentile(timings, 0.95), within33: timings.filter(t => t <= 33).length } : null
    if (!active) throw new Error('The viewer did not initialize the real fixture')
    const graph = active
    expect(graph.device.info.fallback).toBe(false)
    expect(graph.linkCount).toBe(linkCount)
    if (frames.length) {
      const motion = motionChecks(fixture.input.points, await graph.readPositions())
      record.motion = motion
      expect([motion.nonfinite, motion.flagErrors, motion.fixedMoved]).toEqual([0, 0, 0])
      expect(motion.freeMoved).toBeGreaterThan(0)
    }
    expect(hidden).toBe(false)
    expect(timings).toHaveLength(intervals)
    record.status = 'complete'
  } catch (error) {
    record.status = 'failed'
    record.error = String(error)
    throw error
  } finally {
    clearTimeout(timeout)
    view?.destroy()
    document.removeEventListener('visibilitychange', visibility)
    host.remove()
    await writeArtifact('resident-youtube-moving', record)
  }
}, 90000)
