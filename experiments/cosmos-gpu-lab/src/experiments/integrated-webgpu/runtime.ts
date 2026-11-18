import type { QuerySet, RenderPassProps } from '@luma.gl/core'
import { createDevice, describeDevice, waitForGpu } from '../../gpu/luma'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import type { ComputeScope } from '../many-body/backend'
import { cool } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { createRenderer } from './renderer'
import { workload, type Workload } from './data'
export type IntegratedSpring = 'hoist' | 'prefetch'
export type FrameTimestamps = { query: QuerySet; offset: number } | { scope: ComputeScope; draw: RenderPassProps }
export type FrameTrace = { encodeSimulationMs: number; encodeDrawMs: number; completionWaitMs: number }
export type Feedback = { kind: string; ms: number; id: number | null; readMs: number; highlightMs: number; opportunityMs: number }
export const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
export async function createIntegrated (canvas: HTMLCanvasElement, kind: Workload = 'chain', count = 1024): Promise<{
  canvas: HTMLCanvasElement; backend: Awaited<ReturnType<typeof createCombinedWebGPU>>; renderer: ReturnType<typeof createRenderer>;
  readonly springOptimization: IntegratedSpring; readonly data: ReturnType<typeof workload>;
  readonly tick: number; readonly running: boolean; readonly destroyed: boolean;
  readonly error: string; readonly info: string; feedback: Feedback[]; intervals: number[];
  frame(simulate?: boolean, trace?: FrameTrace, timestamps?: FrameTimestamps): Promise<void>; pause(): void; resume(): void; step(): Promise<void>;
  pick(x: number, y: number, start?: number): Promise<number | null>;
  drag(id: number, x: number, y: number, release?: boolean): void;
  pan(dx: number, dy: number): void; zoom(factor: number, x: number, y: number): void;
  replace(kind: Workload, count: number, springOptimization?: IntegratedSpring): Promise<void>;
  resize(width: number, height: number, ratio?: number, pixelRounding?: 'floor' | 'round'): void;
  world(x: number, y: number): [number, number]; screen(x: number, y: number): [number, number]; destroy(): void;
}> {
  let data = workload(kind, count); let tick = 0; let alpha = 1; let running = false; let destroyed = false; let error = ''
  let springOptimization: IntegratedSpring = 'hoist'
  const device = await createDevice('webgpu', canvas, true)
  const makeBackend = async (
    next: ReturnType<typeof workload>, optimization: IntegratedSpring = 'hoist'
  ): Promise<Awaited<ReturnType<typeof createCombinedWebGPU>>> =>
    await createCombinedWebGPU(canvas, next.graph, next.input, 'trig', {
      context: { device },
      gpuBounds: true,
      repulsionPolicy: 'production',
      nearArithmetic: 'refined',
      springOptimization: optimization,
      hubThreshold: 1024,
      forceSettings: { ...forceSettings('reference', next.input.points.length / 4), center: 0.1 },
    })
  let backend!: Awaited<ReturnType<typeof createCombinedWebGPU>>
  let renderer: ReturnType<typeof createRenderer> | undefined
  try {
    backend = await makeBackend(data)
    renderer = createRenderer(() => backend.positionSource!(), data.graph, canvas)
    const drawing = renderer
    let raf = 0; let generation = 0; let lastFrame = 0; let pending: Promise<void> = Promise.resolve()
    let press: { pointer: number; x: number; y: number; id: number | null; token: number; ready: boolean } | undefined
    const feedback: Feedback[] = []; const intervals: number[] = []
    const healthy = (): void => { if (destroyed) throw new Error('Integrated runtime destroyed'); if (error) throw new Error(error) }
    const fail = (e: unknown): void => { if (!destroyed) { error = String(e); api.pause() } }
    const loop = (time: number): void => {
      if (!running || destroyed) return
      if (lastFrame) intervals.push(time - lastFrame)
      lastFrame = time
      pending = api.frame().then(() => { if (running && !destroyed) raf = requestAnimationFrame(loop) }).catch(fail)
    }
    const coords = (event: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]
    }
    const abort = new AbortController(); const listener = { signal: abort.signal }
    const api = {
      canvas,
      get backend (): Awaited<ReturnType<typeof createCombinedWebGPU>> { return backend },
      renderer: drawing,
      feedback,
      intervals,
      get springOptimization (): IntegratedSpring { return springOptimization },
      get data (): ReturnType<typeof workload> { return data },
      get tick (): number { return tick },
      get running (): boolean { return running },
      get destroyed (): boolean { return destroyed },
      get error (): string { return error },
      info: `${describeDevice(device)} · ${JSON.stringify(device.info)} · ${navigator.userAgent}`,
      async frame (simulate = running, trace?: FrameTrace, timestamps?: FrameTimestamps): Promise<void> {
        healthy(); const start = trace ? performance.now() : 0
        if (timestamps && !simulate) throw new Error('Full-frame timestamps require simulation')
        if (simulate) {
          if (timestamps && 'scope' in timestamps) backend.stepProfiledTick!(alpha, tick, timestamps.scope)
          else {
            backend.stepTick!(alpha, tick, timestamps
              ? {
                timestampQuerySet: timestamps.query, beginTimestampIndex: timestamps.offset, endTimestampIndex: timestamps.offset + 1,
              }
              : undefined)
          }
          tick++; alpha = cool(alpha, 5000)
        }
        const simulated = trace ? performance.now() : 0
        drawing.draw(timestamps && 'scope' in timestamps
          ? timestamps.draw
          : timestamps
            ? {
              timestampQuerySet: timestamps.query, beginTimestampIndex: timestamps.offset + 2, endTimestampIndex: timestamps.offset + 3,
            }
            : undefined)
        const drawn = trace ? performance.now() : 0
        // Bound the queue to one completed frame. This pacing cost is included in normal frame intervals.
        await waitForGpu(device)
        if (trace) {
          trace.encodeSimulationMs = simulated - start; trace.encodeDrawMs = drawn - simulated
          trace.completionWaitMs = performance.now() - drawn
        }
      },
      pause (): void { running = false; cancelAnimationFrame(raf); lastFrame = 0 },
      resume (): void { healthy(); if (running) return; running = true; lastFrame = 0; raf = requestAnimationFrame(loop) },
      async step (): Promise<void> { healthy(); api.pause(); await pending; await api.frame(true) },
      world (x: number, y: number): [number, number] {
        const c = drawing.camera; const scale = c.zoom * drawing.ratio
        return [(x - canvas.width / 2) / scale + c.x, -(y - canvas.height / 2) / scale + c.y]
      },
      screen (x: number, y: number): [number, number] {
        const c = drawing.camera; const scale = c.zoom * drawing.ratio
        return [(x - c.x) * scale + canvas.width / 2, -(y - c.y) * scale + canvas.height / 2]
      },
      async pick (x: number, y: number, start = performance.now()): Promise<number | null> {
        healthy(); const token = ++generation
        const id = await drawing.pick(x, y)
        if (destroyed || token !== generation) return null
        const read = performance.now(); drawing.selected = id ?? -1
        await api.frame(false); const highlighted = performance.now(); await nextFrame(); const end = performance.now()
        if (!destroyed && token === generation) {
          feedback.push({
            kind: 'pick', ms: end - start, id, readMs: read - start, highlightMs: highlighted - read, opportunityMs: end - highlighted,
          })
        }
        return id
      },
      drag (id: number, x: number, y: number, release = false): void {
        healthy(); const [wx, wy] = api.world(x, y)
        backend.patchPositions!(id, new Float32Array([wx, wy, release ? data.input.points[id * 4 + 2] : 1, 0]))
        if (!running) drawing.draw()
      },
      pan (dx: number, dy: number): void {
        healthy(); drawing.camera.x -= dx / (drawing.camera.zoom * drawing.ratio)
        drawing.camera.y += dy / (drawing.camera.zoom * drawing.ratio); if (!running) drawing.draw()
      },
      zoom (factor: number, x: number, y: number): void {
        healthy(); const before = api.world(x, y)
        drawing.camera.zoom = Math.max(0.02, Math.min(30, drawing.camera.zoom * factor))
        const after = api.world(x, y); drawing.camera.x += before[0] - after[0]; drawing.camera.y += before[1] - after[1]
        if (!running) drawing.draw()
      },
      async replace (nextKind: Workload, nextCount: number, optimization: IntegratedSpring = 'hoist'): Promise<void> {
        healthy(); const next = workload(nextKind, nextCount); const wasRunning = running
        api.pause(); generation++; press = undefined; await pending; healthy()
        const candidate = await makeBackend(next, optimization)
        try { healthy(); drawing.replace(next.graph) } catch (e) { candidate.destroy(); throw e }
        const previous = backend; backend = candidate; previous.destroy()
        data = next; springOptimization = optimization; tick = 0; alpha = 1; drawing.camera = { x: 0, y: 0, zoom: 2 }
        await api.frame(false); if (wasRunning) api.resume()
      },
      resize (width: number, height: number, ratio = devicePixelRatio, pixelRounding: 'floor' | 'round' = 'round'): void {
        healthy()
        if (![width, height, ratio].every(v => Number.isFinite(v) && v > 0) || width * ratio > 4096 || height * ratio > 4096) {
          throw new Error('Invalid pilot viewport')
        }
        const round = pixelRounding === 'floor' ? Math.floor : Math.round
        canvas.width = round(width * ratio); canvas.height = round(height * ratio)
        drawing.ratio = ratio; device.canvasContext!.resize({ width: canvas.width, height: canvas.height }); drawing.draw()
      },
      destroy (): void {
        if (destroyed) return
        api.pause(); destroyed = true; generation++; abort.abort(); drawing.destroy(); backend.destroy(); device.destroy()
      },
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || press) return
      const [x, y] = coords(event); const state = { pointer: event.pointerId, x, y, id: null as number | null, token: generation + 1, ready: false }
      press = state; canvas.setPointerCapture(event.pointerId)
      api.pick(x, y, event.timeStamp).then(id => {
        if (press === state) { state.ready = true; state.id = id; if (id !== null) api.drag(id, state.x, state.y) }
      }).catch(fail)
    }, listener)
    canvas.addEventListener('pointermove', event => {
      if (!press || press.pointer !== event.pointerId) return
      const [x, y] = coords(event)
      if (press.id !== null) api.drag(press.id, x, y)
      else if (press.ready && press.token === generation) api.pan(x - press.x, y - press.y)
      press.x = x; press.y = y
    }, listener)
    const release = (event: PointerEvent): void => {
      if (!press || press.pointer !== event.pointerId) return
      if (press.id !== null) api.drag(press.id, press.x, press.y, true)
      press = undefined
    }
    canvas.addEventListener('pointerup', release, listener); canvas.addEventListener('pointercancel', release, listener)
    canvas.addEventListener('lostpointercapture', release, listener)
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); api.zoom(Math.exp(-event.deltaY * 0.001), ...coords(event))
    }, { ...listener, passive: false })
    await api.frame(false)
    return api
  } catch (e) { renderer?.destroy(); backend?.destroy(); device.destroy(); throw e }
}
export type Integrated = Awaited<ReturnType<typeof createIntegrated>>
