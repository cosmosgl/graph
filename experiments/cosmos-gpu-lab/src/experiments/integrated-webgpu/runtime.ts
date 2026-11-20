import type { QuerySet, RenderPassProps } from '@luma.gl/core'
import { createDevice, describeDevice, waitForGpu } from '../../gpu/luma'
import { createCombinedWebGPU, type AdditionalForces, type MouseForce } from '../combined-layout/webgpu'
import type { CompositionFixture } from '../combined-layout/force-composition'
import type { ComputeScope } from '../many-body/backend'
import { cool } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { DEFAULT_STRENGTH } from '../mouse-repulsion/data'
import type { MouseArithmetic } from '../mouse-repulsion/webgpu'
import { createRenderer, type ViewerPaint } from './renderer'
import { composeWorkload, workload, type IntegratedForceMode, type Workload } from './data'
import type { createIntegratedReadback, ViewerReadback } from './readback'
export type IntegratedSpring = 'hoist' | 'prefetch'
export type FrameTimestamps = { query: QuerySet; offset: number } | { scope: ComputeScope; draw: RenderPassProps }
export type FrameTrace = { encodeSimulationMs: number; encodeDrawMs: number; completionWaitMs: number }
export type Feedback = {
  kind: string; ms: number; id: number | null; object?: 'point' | 'link'; readMs: number; highlightMs: number; opportunityMs: number;
}
type ClusterChannels = NonNullable<AdditionalForces['cluster']>
type AttractorChannels = NonNullable<AdditionalForces['attractor']>
export type IntegratedForceStep = {
  kind: 'tick' | 'mouse'; tick: number; alpha: number; scale: number;
  mouse?: MouseForce; trustedPointer: boolean; composition?: CompositionFixture;
}
type IntegratedOptions = {
  forces?: IntegratedForceMode; decay?: number; mouseArithmetic?: MouseArithmetic;
  readback?: boolean;
  adaptiveSampling?: boolean;
  paint?: ViewerPaint;
  linkPicking?: boolean;
  onDeviceError?(error: Error): unknown;
  onForceStep?(step: IntegratedForceStep): void | Promise<void>;
}
export const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
export async function createIntegrated (
  canvas: HTMLCanvasElement, kind: Workload = 'chain', count = 1024, options: IntegratedOptions = {}
): Promise<{
  canvas: HTMLCanvasElement; backend: Awaited<ReturnType<typeof createCombinedWebGPU>>; renderer: ReturnType<typeof createRenderer>;
  readonly springOptimization: IntegratedSpring; readonly data: ReturnType<typeof workload>;
  readonly forceMode: IntegratedForceMode; readonly composition?: CompositionFixture;
  readonly tick: number; readonly alpha: number; readonly running: boolean; readonly destroyed: boolean;
  readonly error: string; readonly deviceLabel: string; readonly info: string; feedback: Feedback[]; intervals: number[];
  readonly readback?: ViewerReadback;
  frame(simulate?: boolean, trace?: FrameTrace, timestamps?: FrameTimestamps): Promise<void>;
  pause(clearPointer?: boolean): void; resume(): void; step(): Promise<void>;
  pick(x: number, y: number, start?: number): Promise<number | null>;
  drag(id: number, x: number, y: number, release?: boolean): void;
  patchPositions(first: number, positions: Float32Array): void;
  pan(dx: number, dy: number): void; zoom(factor: number, x: number, y: number): void;
  replace(kind: Workload, count: number, springOptimization?: IntegratedSpring, forces?: IntegratedForceMode): Promise<void>;
  replaceClusters(channels: ClusterChannels): void; replaceAttractors(channels: AttractorChannels): void;
  settle(): Promise<void>;
  resize(width: number, height: number, ratio?: number, pixelRounding?: 'floor' | 'round'): void;
  world(x: number, y: number): [number, number]; screen(x: number, y: number): [number, number]; destroy(): void;
}> {
  let data = workload(kind, count); let tick = 0; let alpha = 1; let running = false; let destroyed = false; let error = ''
  let springOptimization: IntegratedSpring = 'hoist'
  let forceMode = options.forces ?? 'core'
  let composition = composeWorkload(data, forceMode)
  const decay = options.decay ?? 5000
  if (!Number.isInteger(decay) || decay < 1 || decay > 5000) throw new Error('Invalid integrated cooling schedule')
  const device = await createDevice('webgpu', canvas, true, options.onDeviceError)
  const makeBackend = async (
    next: ReturnType<typeof workload>, nextComposition: CompositionFixture | undefined, optimization: IntegratedSpring = 'hoist'
  ): Promise<Awaited<ReturnType<typeof createCombinedWebGPU>>> => {
    const cluster = nextComposition?.cluster
    const attractor = nextComposition?.attractor
    const additionalForces = cluster && attractor
      ? {
        mouse: options.mouseArithmetic ?? 'expanded',
        cluster: { membership: cluster.membership, strengths: cluster.strengths, targets: cluster.targets },
        attractor: { strengths: attractor.strengths, targets: attractor.targets },
      }
      : undefined
    return await createCombinedWebGPU(canvas, next.graph, next.input, 'trig', {
      context: { device },
      gpuBounds: true,
      repulsionPolicy: 'production',
      nearArithmetic: 'refined',
      springOptimization: optimization,
      hubThreshold: 1024,
      adaptiveSampling: options.adaptiveSampling,
      forceSettings: nextComposition?.settings ?? { ...forceSettings('reference', next.input.points.length / 4), center: 0.1 },
      additionalForces,
    })
  }
  let backend!: Awaited<ReturnType<typeof createCombinedWebGPU>>
  let renderer: ReturnType<typeof createRenderer> | undefined
  let readback: Awaited<ReturnType<typeof createIntegratedReadback>> | undefined
  try {
    backend = await makeBackend(data, composition)
    renderer = createRenderer(() => backend.positionSource!(), data.graph, canvas, options.paint)
    const drawing = renderer
    if (options.readback) {
      const { createIntegratedReadback } = await import('./readback')
      readback = await createIntegratedReadback(() => backend.positionSource!(), canvas, drawing, () => tick, data.input.points)
    }
    let raf = 0; let generation = 0; let lastFrame = 0; let pending: Promise<void> = Promise.resolve()
    let press: { pointer: number; x: number; y: number; id: number | null; token: number; ready: boolean } | undefined
    let secondary: { pointer: number; x: number; y: number } | undefined
    let inFrame = false; let stepping = false; let replacing = false
    const feedback: Feedback[] = []; const intervals: number[] = []
    const healthy = (): void => { if (destroyed) throw new Error('Integrated runtime destroyed'); if (error) throw new Error(error) }
    const fail = (e: unknown): void => { if (!destroyed) { error = String(e); api.pause() } }
    const wantsFrame = (): boolean => !destroyed && !error && !stepping && !replacing && (running || !!secondary)
    const schedule = (): void => { if (!raf && !inFrame && wantsFrame()) raf = requestAnimationFrame(loop) }
    const loop = (time: number): void => {
      raf = 0
      if (!wantsFrame()) return
      if (running) {
        if (lastFrame) intervals.push(time - lastFrame)
        lastFrame = time
      }
      inFrame = true
      const frame = running ? api.frame() : renderFrame(false, undefined, undefined, true)
      pending = frame.catch(fail).finally(() => { inFrame = false; schedule() })
    }
    const coords = (event: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]
    }
    const abort = new AbortController(); const listener = { signal: abort.signal }
    const clearSecondary = (): void => {
      const previous = secondary; secondary = undefined
      if (!previous) return
      if (canvas.hasPointerCapture(previous.pointer)) canvas.releasePointerCapture(previous.pointer)
      if (!destroyed && !device.isLost) backend.setMouseRepulsion?.()
      if (!running) { cancelAnimationFrame(raf); raf = 0 }
    }
    const renderFrame = async (simulate: boolean, trace?: FrameTrace, timestamps?: FrameTimestamps, pausedMouse = false): Promise<void> => {
      healthy(); const start = trace ? performance.now() : 0
      if (timestamps && !simulate) throw new Error('Full-frame timestamps require simulation')
      if (composition && timestamps && 'scope' in timestamps) throw new Error('Composed forces require normal-frame timing')
      const pointer = composition && (simulate || pausedMouse) ? secondary : undefined
      let mouse: MouseForce | undefined
      if (pointer) {
        const [x, y] = api.world(pointer.x, pointer.y)
        mouse = { world: [Math.fround(x), Math.fround(y)], strength: DEFAULT_STRENGTH }
      }
      const forceTick = tick; const forceAlpha = alpha; const forceComposition = composition
      const forceScale = drawing.camera.zoom * drawing.ratio
      if (simulate || pausedMouse) backend.setMouseRepulsion?.(mouse)
      let moved = simulate
      if (simulate) {
        if (timestamps && 'scope' in timestamps) backend.stepProfiledTick!(alpha, tick, timestamps.scope)
        else {
            backend.stepTick!(alpha, tick, timestamps
              ? {
                timestampQuerySet: timestamps.query, beginTimestampIndex: timestamps.offset, endTimestampIndex: timestamps.offset + 1,
              }
              : undefined)
        }
        tick++; alpha = cool(alpha, decay)
        if (mouse) alpha = Math.max(alpha, 0.1)
      } else if (mouse) moved = backend.stepAdditionalForce!('mouse', alpha)
      const simulated = trace ? performance.now() : 0
      drawing.draw(timestamps && 'scope' in timestamps
        ? timestamps.draw
        : timestamps
          ? {
            timestampQuerySet: timestamps.query, beginTimestampIndex: timestamps.offset + 2, endTimestampIndex: timestamps.offset + 3,
          }
          : undefined)
      if (moved) readback?.moved()
      const drawn = trace ? performance.now() : 0
      // Bound the queue to one completed frame. This pacing cost is included in normal frame intervals.
      await waitForGpu(device)
      if (trace) {
        trace.encodeSimulationMs = simulated - start; trace.encodeDrawMs = drawn - simulated
        trace.completionWaitMs = performance.now() - drawn
      }
      if (options.onForceStep && (simulate || mouse) && !destroyed) {
        await options.onForceStep({
          kind: simulate ? 'tick' : 'mouse',
          tick: forceTick,
          alpha: forceAlpha,
          scale: forceScale,
          composition: forceComposition,
          mouse,
          trustedPointer: !!mouse,
        })
      }
    }
    const deviceLabel = describeDevice(device)
    const api = {
      canvas,
      get backend (): Awaited<ReturnType<typeof createCombinedWebGPU>> { return backend },
      renderer: drawing,
      readback: readback?.api,
      feedback,
      intervals,
      get springOptimization (): IntegratedSpring { return springOptimization },
      get data (): ReturnType<typeof workload> { return data },
      get forceMode (): IntegratedForceMode { return forceMode },
      get composition (): CompositionFixture | undefined { return composition },
      get tick (): number { return tick },
      get alpha (): number { return alpha },
      get running (): boolean { return running },
      get destroyed (): boolean { return destroyed },
      get error (): string { return error },
      deviceLabel,
      info: `${deviceLabel} · ${JSON.stringify(device.info)} · ${navigator.userAgent}`,
      frame (simulate = running, trace?: FrameTrace, timestamps?: FrameTimestamps): Promise<void> {
        return renderFrame(simulate, trace, timestamps)
      },
      pause (clearPointer = false): void {
        running = false; cancelAnimationFrame(raf); raf = 0; lastFrame = 0
        if (clearPointer) clearSecondary()
        schedule()
      },
      resume (): void { healthy(); if (running) return; running = true; lastFrame = 0; schedule() },
      async settle (): Promise<void> { await pending },
      async step (): Promise<void> {
        healthy()
        if (replacing || stepping) throw new Error('Integrated graph update already in progress')
        stepping = true; api.pause()
        try { await pending; await api.frame(true) } finally { stepping = false; schedule() }
      },
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
        const object = options.linkPicking ? await drawing.pickObject(x, y) : undefined
        const id = options.linkPicking ? object?.id ?? null : await drawing.pick(x, y)
        if (destroyed || token !== generation) return null
        const point = object?.kind === 'link' ? null : id
        const read = performance.now()
        drawing.selected = point ?? -1
        drawing.selectedLink = object?.kind === 'link' ? object.id : -1
        await api.frame(false); const highlighted = performance.now(); await nextFrame(); const end = performance.now()
        if (!destroyed && token === generation) {
          feedback.push({
            kind: 'pick',
            ms: end - start,
            id,
            ...(object ? { object: object.kind } : {}),
            readMs: read - start,
            highlightMs: highlighted - read,
            opportunityMs: end - highlighted,
          })
        }
        return point
      },
      drag (id: number, x: number, y: number, release = false): void {
        healthy(); const [wx, wy] = api.world(x, y)
        api.patchPositions(id, new Float32Array([wx, wy, release ? data.input.points[id * 4 + 2] : 1, 0]))
      },
      patchPositions (first: number, positions: Float32Array): void {
        healthy()
        if (replacing) throw new Error('Integrated graph update already in progress')
        backend.patchPositions!(first, positions); readback?.patched(first, positions)
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
      async replace (
        nextKind: Workload, nextCount: number, optimization: IntegratedSpring = 'hoist', nextForces: IntegratedForceMode = forceMode
      ): Promise<void> {
        healthy()
        if (replacing || stepping) throw new Error('Integrated graph update already in progress')
        const next = workload(nextKind, nextCount); const nextComposition = composeWorkload(next, nextForces)
        const wasRunning = running
        replacing = true
        readback?.beginReplacement()
        let replaced = false
        try {
          api.pause(true); generation++; press = undefined; await pending; healthy()
          const candidate = await makeBackend(next, nextComposition, optimization)
          try { healthy(); drawing.replace(next.graph) } catch (e) { candidate.destroy(); throw e }
          const previous = backend; backend = candidate; previous.destroy()
          data = next; composition = nextComposition; forceMode = nextForces
          springOptimization = optimization; tick = 0; alpha = 1; drawing.camera = { x: 0, y: 0, zoom: 2 }
          replaced = true
          await api.frame(false)
        } finally {
          replacing = false
          readback?.endReplacement(replaced ? next.input.points : undefined)
          if (wasRunning && !destroyed && !error) api.resume()
        }
      },
      replaceClusters (channels: ClusterChannels): void {
        healthy()
        if (!composition || replacing) throw new Error('Load a composed graph before updating clusters')
        const cluster = { membership: channels.membership.slice(), strengths: channels.strengths.slice(), targets: channels.targets.slice() }
        backend.replaceClusters!(cluster)
        composition = { ...composition, cluster: { ...data.input, ...cluster } }
      },
      replaceAttractors (channels: AttractorChannels): void {
        healthy()
        if (!composition || replacing) throw new Error('Load a composed graph before updating targets')
        const attractor = { targets: channels.targets?.slice(), strengths: channels.strengths?.slice() }
        backend.replaceAttractors!(attractor)
        composition = { ...composition, attractor: { ...data.input, ...attractor } }
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
        destroyed = true; generation++; abort.abort(); api.pause(true); readback?.destroy(); drawing.destroy(); backend.destroy(); device.destroy()
      },
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button === 2 && composition) {
        if (!event.isTrusted || press || secondary || replacing || destroyed || error) return
        event.preventDefault()
        const [x, y] = coords(event)
        secondary = { pointer: event.pointerId, x, y }
        canvas.setPointerCapture(event.pointerId)
        schedule()
        return
      }
      if (event.button !== 0 || press || secondary || replacing) return
      const [x, y] = coords(event); const state = { pointer: event.pointerId, x, y, id: null as number | null, token: generation + 1, ready: false }
      press = state; canvas.setPointerCapture(event.pointerId)
      api.pick(x, y, event.timeStamp).then(id => {
        if (press === state) { state.ready = true; state.id = id; if (id !== null) api.drag(id, state.x, state.y) }
      }).catch(fail)
    }, listener)
    canvas.addEventListener('pointermove', event => {
      if (secondary?.pointer === event.pointerId) {
        if (event.isTrusted) {
          if (event.buttons & 2) [secondary.x, secondary.y] = coords(event)
          else clearSecondary()
        }
        return
      }
      if (!press || press.pointer !== event.pointerId) return
      const [x, y] = coords(event)
      if (press.id !== null) api.drag(press.id, x, y)
      else if (press.ready && press.token === generation) api.pan(x - press.x, y - press.y)
      press.x = x; press.y = y
    }, listener)
    const release = (event: PointerEvent): void => {
      if (secondary?.pointer === event.pointerId && event.isTrusted) { clearSecondary(); return }
      if (!press || press.pointer !== event.pointerId) return
      if (press.id !== null) api.drag(press.id, press.x, press.y, true)
      press = undefined
    }
    canvas.addEventListener('pointerup', release, listener); canvas.addEventListener('pointercancel', release, listener)
    canvas.addEventListener('lostpointercapture', release, listener)
    canvas.addEventListener('contextmenu', event => { if (composition) event.preventDefault() }, listener)
    window.addEventListener('blur', clearSecondary, listener)
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearSecondary() }, listener)
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); api.zoom(Math.exp(-event.deltaY * 0.001), ...coords(event))
    }, { ...listener, passive: false })
    await api.frame(false)
    return api
  } catch (e) { readback?.destroy(); renderer?.destroy(); backend?.destroy(); device.destroy(); throw e }
}
export type Integrated = Awaited<ReturnType<typeof createIntegrated>>
