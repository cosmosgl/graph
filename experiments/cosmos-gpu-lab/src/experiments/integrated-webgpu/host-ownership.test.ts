import { luma, type Buffer, type Device } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { pixels, target } from '../../gpu/rgba-readback'
import { BufferLedger, resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { gravity } from '../combined-layout/reference'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { workload } from './data'

const WIDTH = 512
const HEIGHT = 64
const HOST_X = 0.625
const MARKER = [255, 0, 0, 255]
const BACKGROUND = [0, 0, 0, 255]
const gpuProcessLoss = import.meta.env.VITE_LAB_GPU_PROCESS_LOSS === '1'
declare module 'vitest/browser' {
  interface BrowserCommands { crashIsolatedGpu(): Promise<void> }
}
const source = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@vertex fn vertexMain(@builtin(vertex_index) corner: u32) -> @builtin(position) vec4f {
  let quad = array<vec2f, 4>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(-1., 1.), vec2f(1., 1.));
  return vec4f(positions[0].xy + quad[corner] * vec2f(0.006, 0.07), 0., 1.);
}
@fragment fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1., 0., 0., 1.);
}
`
type Host = {
  device: Device;
  canvas: HTMLCanvasElement;
  errors: string[];
  draw(positionBuffer?: Buffer): void;
  capture(positionBuffer?: Buffer): Promise<Uint8Array>;
}

async function createHost (scope: ReturnType<typeof resourceScope>): Promise<Host> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  document.body.append(canvas)
  scope.own({ destroy: () => canvas.remove() })
  const errors: string[] = []
  const device = scope.own(await createDevice('webgpu', canvas, false, error => {
    errors.push(error.message)
    return true
  }))
  const offscreen = scope.own(target(device, WIDTH, HEIGHT))
  const hostBuffer = scope.own(upload(device, new Float32Array([HOST_X, 0, 0, 0])))
  const shaderLayout = { attributes: [], bindings: bindingLayout([['positions', 'read-only-storage']]) }
  const kernel = scope.own(new RenderKernel(device, {
    vertexSource: source,
    fragmentSource: source,
    vertexEntryPoint: 'vertexMain',
    fragmentEntryPoint: 'fragmentMain',
    topology: 'triangle-strip',
    colorAttachmentFormats: ['rgba8unorm'],
    shaderLayout,
  }))
  const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
  const draw = (positionBuffer?: Buffer): void => {
    const pass = device.beginRenderPass({ framebuffer: offscreen.framebuffer, clearColor: [0, 0, 0, 1], clearDepth: false })
    try {
      if (positionBuffer) kernel.draw(pass, { vertexArray, vertexCount: 4, bindings: { positions: positionBuffer } })
      kernel.draw(pass, { vertexArray, vertexCount: 4, bindings: { positions: hostBuffer } })
    } finally { pass.end() }
    device.submit()
  }
  return {
    device,
    canvas,
    errors,
    draw,
    async capture (positionBuffer): Promise<Uint8Array> {
      draw(positionBuffer)
      return await pixels(device, offscreen.texture, offscreen.framebuffer)
    },
  }
}

function markerPixel (rgba: Uint8Array, clipX: number): { x: number; rgba: number[] } {
  const x = Math.floor((clipX + 1) * WIDTH / 2)
  const offset = (HEIGHT / 2 * WIDTH + x) * 4
  return { x, rgba: Array.from(rgba.subarray(offset, offset + 4)) }
}

const lossMethod = gpuProcessLoss ? 'Chrome GPU process loss' : 'explicit device destruction'
it.skipIf(import.meta.env.VITE_LAB_HOST_OWNERSHIP !== '1')(`shares resident positions with a host and rebuilds after ${lossMethod}`, async () => {
  const scope = resourceScope()
  const ledger = new BufferLedger()
  const fixture = workload('chain', 32)
  fixture.input.points.set([-0.625, 0, 0, 0])
  const report: Record<string, unknown> = {
    luma: luma.VERSION,
    fixture: '32-point chain',
    attachment: [WIDTH, HEIGHT],
    lossMethod,
    source: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    run: import.meta.env.LAB_RUN_ID,
  }
  const frames: unknown[] = []
  report.frames = frames
  const createLayout = async (host: Host, points = fixture.input.points): ReturnType<typeof createCombinedWebGPU> => scope.own(
    await createCombinedWebGPU(host.canvas, { ...fixture.graph, points }, { ...fixture.input, points }, 'baseline', {
      context: { device: host.device, ledger }, repulsionPolicy: 'production',
    })
  )
  const verify = async (name: string, host: Host, clipX: number, buffer?: Buffer, oldX?: number): Promise<void> => {
    const color = await host.capture(buffer)
    const position = markerPixel(color, clipX)
    const hostMarker = markerPixel(color, HOST_X)
    const oldPosition = oldX === undefined ? undefined : markerPixel(color, oldX)
    frames.push({ name, position, hostMarker, oldPosition, buffer: buffer?.id })
    expect(hostMarker.rgba, name).toEqual(MARKER)
    expect(position.rgba, name).toEqual(buffer ? MARKER : BACKGROUND)
    if (oldPosition) expect(oldPosition.rgba, name).toEqual(BACKGROUND)
  }
  try {
    const host = await createHost(scope)
    report.original = describeEnvironment(host.device, host.canvas)
    report.originalErrors = host.errors
    expect(host.device.info.fallback).toBe(false)
    expect(document.visibilityState).toBe('visible')
    expect(navigator.userAgent).not.toContain('HeadlessChrome')
    const layout = await createLayout(host)
    const before = layout.positionSource!()
    const startX = fixture.input.points[0]
    expect(before.device).toBe(host.device)
    await verify('initial shared buffer', host, startX, before.buffer)

    const reference = gravity(fixture.input.points, 1).positions
    layout.stepStage('gravity', 1)
    const moved = layout.positionSource!()
    expect(moved.device).toBe(host.device)
    expect(moved.buffer).not.toBe(before.buffer)
    await verify('GPU-updated shared buffer', host, reference[0], moved.buffer, startX)
    const checkpoint = (await layout.read()).positions
    expect(checkpoint[0]).toBeCloseTo(reference[0], 6)
    report.checkpoint = Array.from(checkpoint)

    const beforeCleanup = { bytes: ledger.liveBytes, buffers: ledger.liveBuffers }
    expect(beforeCleanup.buffers).toBeGreaterThan(0)
    layout.destroy()
    report.cleanup = { beforeCleanup, bytes: ledger.liveBytes, buffers: ledger.liveBuffers, hostLost: host.device.isLost }
    expect(before.buffer.destroyed && moved.buffer.destroyed).toBe(true)
    expect(ledger.liveBuffers).toBe(0)
    expect(ledger.liveBytes).toBe(0)
    expect(host.device.isLost).toBe(false)
    await verify('host draws after layout cleanup', host, reference[0])

    const losing = await createLayout(host, checkpoint)
    const preLoss = losing.positionSource!()
    expect(preLoss.device).toBe(host.device)
    await verify('replacement layout on the same host', host, checkpoint[0], preLoss.buffer)
    let framesBeforeLoss = 0
    let animation = 0
    let timeout: ReturnType<typeof setTimeout> | undefined
    const frame = (): void => {
      if (host.device.isLost) return
      try {
        losing.stepStage('gravity', 1)
        host.draw(losing.positionSource!().buffer)
        framesBeforeLoss++
        animation = requestAnimationFrame(frame)
      } catch (error) { report.lastFrameError = String(error) }
    }
    try {
      if (gpuProcessLoss) {
        expect(report.source && report.snapshot && report.run).toBeTruthy()
        frame()
        await commands.crashIsolatedGpu()
      } else host.device.destroy()
      report.loss = await Promise.race([
        host.device.lost,
        new Promise<never>((resolve, reject) => { timeout = setTimeout(() => reject(new Error('No WebGPU device loss notification')), 12000) }),
      ])
    } finally {
      cancelAnimationFrame(animation)
      clearTimeout(timeout)
      report.framesBeforeLoss = framesBeforeLoss
    }
    if (gpuProcessLoss) expect(framesBeforeLoss).toBeGreaterThan(0)
    expect(report.loss).toMatchObject({ reason: gpuProcessLoss ? 'unknown' : 'destroyed' })
    expect(host.device.isLost).toBe(true)
    expect(() => losing.stepStage('gravity', 1)).toThrow(/device lost/i)
    losing.destroy()
    expect(preLoss.buffer.destroyed).toBe(true)
    expect(ledger.liveBuffers).toBe(0)

    const freshHost = await createHost(scope)
    report.replacement = describeEnvironment(freshHost.device, freshHost.canvas)
    report.replacementErrors = freshHost.errors
    expect(freshHost.device.info.fallback).toBe(false)
    expect(freshHost.device).not.toBe(host.device)
    const rebuilt = await createLayout(freshHost, checkpoint)
    const restored = rebuilt.positionSource!()
    expect(restored.device).toBe(freshHost.device)
    expect((await rebuilt.read()).positions).toEqual(checkpoint)
    await verify('checkpoint restored on the new device', freshHost, checkpoint[0], restored.buffer)
    const next = gravity(checkpoint, 1).positions
    rebuilt.stepStage('gravity', 1)
    await verify('resumed GPU movement', freshHost, next[0], rebuilt.positionSource!().buffer, checkpoint[0])
    expect((await rebuilt.read()).positions[0]).toBeCloseTo(next[0], 6)
    rebuilt.destroy()
    expect(ledger.liveBuffers).toBe(0)
    expect(host.errors).toEqual([])
    expect(freshHost.errors).toEqual([])
    report.passed = true
  } catch (error) {
    report.failure = String(error)
    throw error
  } finally {
    try { scope.destroy() } finally { await writeArtifact(gpuProcessLoss ? 'host-gpu-process-loss' : 'host-ownership', report) }
  }
})
