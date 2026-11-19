import { Deck, Layer, OrthographicView } from '@deck.gl/core'
import { Buffer, luma, type TextureFormatDepthStencil, type RenderPipelineParameters, type VertexArray } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import { expect, it, vi } from 'vitest'
import { describeEnvironment } from '../src/gpu/force-preview'
import { bindingLayout, createDevice, upload } from '../src/gpu/luma'
import { pixels, target } from '../src/gpu/rgba-readback'
import { BufferLedger, resourceScope } from '../src/gpu/resource-scope'
import { createGraph } from '../src/experiments/combined-layout/data'
import { gravity } from '../src/experiments/combined-layout/reference'
import { createCombinedWebGPU } from '../src/experiments/combined-layout/webgpu'
import { writeArtifact } from '../src/testing/artifacts'

const width = 512
const height = 256
const graphColor = [1, 0, 0, 1] as const
const hostColor = [0, 1, 0, 1] as const
const start = [-125, -18, 0] as const
const hostMarker = [106, 28, 0] as const
const shader = `
struct View { transform: vec4f, color: vec4f, halfSize: vec4f }
struct Vertex { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> view: View;
@vertex fn vertexMain(@builtin(vertex_index) corner: u32, @builtin(instance_index) index: u32) -> Vertex {
  let corners = array<vec2f,4>(vec2f(-1.,-1.), vec2f(1.,-1.), vec2f(-1.,1.), vec2f(1.,1.));
  let point = positions[index];
  let center = point.xy * view.transform.zw + view.transform.xy;
  let clip = select(center + corners[corner] * view.halfSize.xy, vec2f(3.), point.w > 0.5);
  return Vertex(vec4f(clip,0.,1.), index);
}
@fragment fn color() -> @location(0) vec4f { return view.color; }
@fragment fn ids(vertex: Vertex) -> @location(0) vec4f {
  let id = vertex.index + 1u;
  return vec4f(vec3f(f32(id & 255u), f32((id >> 8u) & 255u), f32((id >> 16u) & 255u)) / 255., 1.);
}`

type MarkerProps = { count: number; color: readonly number[]; positions(): Buffer; onFinalize?(): void }
type MarkerState = {
  scope: ReturnType<typeof resourceScope>; params: Buffer; paint: RenderKernel; ids: RenderKernel; vertexArray: VertexArray;
}

class ResidentMarkerLayer extends Layer<MarkerProps> {
  public static layerName = 'ResidentMarkerLayer'
  public declare state: MarkerState

  public initializeState ({ device }: Layer['context']): void {
    const scope = resourceScope()
    try {
      const shaderLayout = { attributes: [], bindings: bindingLayout([['positions', 'read-only-storage'], ['view', 'uniform']]) }
      const params = scope.own(upload(device, new Float32Array(12), Buffer.UNIFORM))
      const create = (
        fragmentEntryPoint: string, parameters: RenderPipelineParameters = {}, depthStencilAttachmentFormat?: TextureFormatDepthStencil
      ): RenderKernel => scope.own(new RenderKernel(device, {
        vertexSource: shader,
        fragmentSource: shader,
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint,
        topology: 'triangle-strip',
        shaderLayout,
        colorAttachmentFormats: ['rgba8unorm'],
        depthStencilAttachmentFormat,
        parameters,
      }))
      const paint = create('color')
      const ids = create('ids', {
        depthWriteEnabled: false,
        depthCompare: 'always',
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'zero',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'constant',
        blendAlphaDstFactor: 'zero',
      }, 'depth16unorm')
      const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
      this.setState({ scope, params, paint, ids, vertexArray })
    } catch (error) { scope.destroy(); throw error }
  }

  public draw ({ renderPass, shaderModuleProps, context }: Parameters<Layer['draw']>[0]): void {
    const viewport = context.viewport
    const [x, y] = viewport.project([0, 0, 0])
    const [u, v] = viewport.project([1, 1, 0])
    const { width: w, height: h } = viewport
    const { params, paint, ids, vertexArray } = this.state
    params.write(new Float32Array([2 * x / w - 1, 1 - 2 * y / h, 2 * (u - x) / w, 2 * (y - v) / h, ...this.props.color, 4 / w, 4 / h, 0, 0]))
    const kernel = shaderModuleProps.picking?.isActive ? ids : paint
    kernel.draw(renderPass, {
      vertexArray,
      vertexCount: 4,
      instanceCount: this.props.count,
      bindings: { positions: this.props.positions(), view: params },
    })
  }

  public finalizeState (): void { this.state.scope?.destroy(); this.props.onFinalize?.() }
}

it('draws and picks resident positions in the Deck view on one borrowed WebGPU device', async () => {
  const scope = resourceScope()
  const ledger = new BufferLedger()
  const errors: string[] = []
  const report: Record<string, unknown> = { luma: luma.VERSION, source: import.meta.env.LAB_SOURCE_REVISION, snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height; document.body.append(canvas)
  let deck: Deck<OrthographicView> | undefined
  try {
    expect(luma.VERSION).toBe('10.0.0-alpha.14')
    expect(report.source && report.snapshot && import.meta.env.LAB_RUN_ID).toBeTruthy()
    const device = scope.own(await createDevice('webgpu', canvas, false, (error): boolean => { errors.push(error.message); return true }))
    const attachment = scope.own(target(device, width, height))
    const hostPosition = scope.own(upload(device, new Float32Array([...hostMarker.slice(0, 2), 0, 0])))
    const { graph, input } = createGraph({ fixture: 'chain', count: 32, decay: 100 })
    for (let i = 3; i < input.points.length; i += 4) input.points[i] = 1
    input.points.set([...start.slice(0, 2), 0, 0])
    const layout = scope.own(await createCombinedWebGPU(canvas, graph, input, 'baseline', { context: { device, ledger }, repulsionPolicy: 'production' }))
    const hostLayer = new ResidentMarkerLayer({ id: 'host', count: 1, color: hostColor, positions: (): Buffer => hostPosition })
    let detached = false
    const graphLayer = new ResidentMarkerLayer({
      id: 'cosmos',
      count: 32,
      color: graphColor,
      positions: (): Buffer => layout.positionSource!().buffer,
      pickable: true,
      data: Array.from({ length: 32 }, (_, i) => i),
      onFinalize: (): void => { detached = true },
    })
    const environment = describeEnvironment(device, canvas)
    report.environment = environment
    expect(environment.device.fallback).toBe(false)
    expect(document.visibilityState).toBe('visible')
    expect(navigator.userAgent).not.toContain('HeadlessChrome')
    let deckDevice: typeof device | undefined
    const views = new OrthographicView({ id: 'layout' })
    const activeDeck = new Deck({
      device,
      canvas,
      width,
      height,
      useDevicePixels: false,
      views,
      viewState: { target: [0, 0, 0], zoom: 0 },
      _framebuffer: attachment.framebuffer,
      layers: [graphLayer, hostLayer],
      onDeviceInitialized: (initial): void => { deckDevice = initial },
      onError: (error): void => { errors.push(error.message) },
    })
    deck = activeDeck
    await vi.waitFor(() => expect(activeDeck.isInitialized).toBe(true))
    expect(deckDevice).toBe(device)
    expect(layout.positionSource!().device).toBe(deckDevice)
    const pixelAt = (color: Uint8Array, [x, y]: readonly number[]): number[] => {
      const offset = (Math.floor(y) * width + Math.floor(x)) * 4
      return Array.from(color.subarray(offset, offset + 4))
    }
    const verify = async (name: string, position: readonly number[], drawn: boolean): Promise<void> => {
      activeDeck.redraw(name)
      const viewport = activeDeck.getViewports()[0]
      const project = (point: readonly number[]): number[] => viewport.project([...point])
      const [x, y] = project(position)
      const image = await pixels(device, attachment.texture, attachment.framebuffer)
      const graphPixel = pixelAt(image, [x, y]); const hostPixel = pixelAt(image, project(hostMarker))
      const pick = await activeDeck.pickObjectAsync({ x: Math.floor(x), y: Math.floor(y) })
      report[name] = { position, projected: [x, y], graphPixel, hostPixel, pick: pick?.index, layer: pick?.layer?.id }
      expect(hostPixel, name).toEqual([0, 255, 0, 255])
      expect(graphPixel.slice(0, 3), name).toEqual(drawn ? [255, 0, 0] : [0, 0, 0])
      expect(pick?.layer?.id, name).toBe(drawn ? 'cosmos' : undefined)
      expect(pick?.index, name).toBe(drawn ? 0 : undefined)
    }
    await verify('initial', start, true)
    const before = layout.positionSource!().buffer
    layout.stepStage('gravity', 1)
    const current = gravity(input.points, 1).positions
    expect(layout.positionSource!().buffer).not.toBe(before)
    activeDeck.setProps({ viewState: { target: [-11, 5, 0], zoom: 0.5 } })
    const moved = [current[0], current[1], 0]
    await verify('moved and camera changed', moved, true)

    activeDeck.setProps({ layers: [hostLayer] })
    await vi.waitFor(() => expect(detached).toBe(true))
    layout.destroy()
    expect(ledger.liveBuffers).toBe(0)
    expect(device.isLost).toBe(false)
    await verify('host after layout removal', moved, false)
    activeDeck.finalize(); deck = undefined
    expect(device.isLost).toBe(false)
    expect(errors).toEqual([])
    report.passed = true
  } catch (error) {
    report.error = String(error)
    throw error
  } finally {
    deck?.finalize(); scope.destroy(); canvas.remove()
    await writeArtifact('deck-host', { ...report, errors })
  }
}, 60000)
