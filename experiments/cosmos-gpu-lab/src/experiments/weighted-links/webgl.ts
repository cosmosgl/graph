import { luma, Texture, UniformStore, type Buffer, type Framebuffer, type QuerySet, type RenderPassProps } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { webgl2Adapter, type WebGLDevice } from '@luma.gl/webgl'
import { forceFrag } from '../../../../../src/modules/ForceLink/force-spring'
import quad from '../../../../../src/modules/Shared/quad.vert?raw'
import integrateSource from '../../../../../src/modules/Points/update-position.frag?raw'
import type { LinkBackend, Measurement, Stage, SetupSubmission, WebGLCheckpoint } from './backend'
import type { GraphInput, Parameters, Topology } from './data'
import type { Snapshot } from './reference'
import { readCanvasPixels } from './webgl-readback'
import { normalizeMeasurement, TIMING_POLICY, waitForWebGLFence, readLumaTimer } from './timing'

const pipelineParameters = {
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilCompare: 'always',
  cullMode: 'none',
  frontFace: 'ccw',
} as const
const renderUniformBlock = `layout(std140) uniform renderUniforms {
  int pointSize; int linkSize; int isLink;
};`
const renderVertex = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D positions; uniform sampler2D links;
${renderUniformBlock}
out vec3 color;
vec4 pointAt(int i) { return texelFetch(positions, ivec2(i % pointSize, i / pointSize), 0); }
void main() {
  int i = gl_VertexID; bool absent = false;
  if (isLink == 1) {
    int edge = i / 2; vec2 endpoints = texelFetch(links, ivec2(edge % linkSize, edge / linkSize), 0).xy;
    absent = pointAt(int(endpoints.x)).w > 0.5 || pointAt(int(endpoints.y)).w > 0.5;
    i = int(i % 2 == 0 ? endpoints.x : endpoints.y);
  }
  vec4 p = pointAt(i); gl_Position = vec4(p.xy, 0., 1.); gl_PointSize = 5.;
  if (p.w > 0.5 || absent) gl_Position = vec4(3.,3.,0.,1.);
  color = isLink == 1 ? vec3(0.27,0.35,0.43) : (p.z > 0.5 ? vec3(1.,0.72,0.4) : vec3(0.48,0.76,0.84));
}`
const renderFragment = `#version 300 es
precision highp float;
precision highp int;
${renderUniformBlock}
in vec3 color; out vec4 outColor;
void main() { if (isLink == 0 && length(gl_PointCoord * 2. - 1.) > 1.) discard; outColor = vec4(color, 1.); }`

export function springShader (maxDegree: number, stopAtDegree: boolean): string {
  const source = forceFrag(maxDegree)
  if (!stopAtDegree) return source
  const guard = 'if (i < linkAmount) {'
  // Controlled lab variant: keep every ordered spring update; omit only the exhausted loop tail.
  if (!source.includes(guard)) throw new Error('Production spring loop changed; review the early-exit variant')
  return source.replace(guard, 'if (i >= linkAmount) break;\n      {')
}

export async function createWebGLBackend (
  canvas: HTMLCanvasElement, stopAtDegree: () => boolean = (): boolean => false,
  synchronization: () => 'pixel' | 'fence' = (): 'pixel' | 'fence' => 'pixel',
  onCheckpoint?: (checkpoint: WebGLCheckpoint) => void
): Promise<LinkBackend> {
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas, autoResize: false, useDevicePixels: false },
    webgl: { antialias: false, alpha: false, depth: false, stencil: false },
  }) as WebGLDevice
  // Native access is limited to context/error diagnostics and the optional completion fence.
  const gl = device.handle
  let phase = 'creating resources'; let lossMessage = ''; let sequence = 0
  const checkpoint = (label: string): void => {
    phase = label
    onCheckpoint?.({ sequence: ++sequence, atMs: performance.now(), phase, contextLost: gl.isContextLost() })
  }
  const contextLost = (event: Event): void => {
    lossMessage = (event as WebGLContextEvent).statusMessage || 'no browser status message'
    checkpoint(`context-lost event; last checkpoint: ${phase}`)
  }
  canvas.addEventListener('webglcontextlost', contextLost)
  const assertHealthy = (): void => {
    if (gl.isContextLost()) throw new Error(`WebGL context lost during ${phase}${lossMessage ? `: ${lossMessage}` : ''}`)
  }
  // Only check at untimed boundaries: invalid readbacks must not masquerade as numerical failures.
  const checkError = (): void => {
    assertHealthy()
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)} during ${phase}`)
  }
  const hasTimer = device.features.has('timestamp-query')
  if (!device.isTextureFormatRenderable('rgba32float')) { device.destroy(); throw new Error('RGBA32F render targets unavailable') }
  const models: Model[] = []; const textures: Texture[] = []; const fbos: Framebuffer[] = []
  const stores: Array<{ destroy(): void }> = []
  const quadBuffer = device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) })
  const clear = (): void => {
    models.splice(0).forEach(model => model.destroy())
    fbos.splice(0).forEach(fbo => fbo.destroy())
    stores.splice(0).forEach(store => store.destroy())
    textures.splice(0).forEach(texture => texture.destroy())
  }
  let graph: GraphInput; let topology: Topology; let params: Parameters; let uploadCallMs = 0
  let pointSize: number; let linkSize: number
  let positions: Texture[]; let forces: Texture[]; let positionFbos: Framebuffer[]; let forceFbos: Framebuffer[]
  let directionTextures: Array<Record<string, Texture>>
  let exit: Texture; let pinned: Texture; let sizes: Texture; let links: Texture
  let springs: Model[]; let integrate: Model; let renderPoints: Model; let renderLinks: Model
  let renderUniforms: UniformStore<{ renderUniforms: { pointSize: number; linkSize: number; isLink: number } }>
  let activeTimer: QuerySet | undefined
  const timestamps = (begin: boolean, end: boolean): Partial<RenderPassProps> => activeTimer && (begin || end)
    ? { timestampQuerySet: activeTimer, beginTimestampIndex: begin ? 0 : undefined, endTimestampIndex: end ? 1 : undefined }
    : {}
  const uploadTexture = (target: Texture, input: Float32Array): void => {
    const padded = new Float32Array(target.width * target.height * 4); padded.set(input)
    const started = performance.now()
    target.copyImageData({ data: padded, bytesPerRow: target.width * 16, mipLevel: 0, x: 0, y: 0 })
    uploadCallMs += performance.now() - started
  }
  const texture = (size: number, input: Float32Array): Texture => {
    const result = device.createTexture({
      width: size,
      height: size,
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC | Texture.COPY_DST,
      sampler: { minFilter: 'nearest', magFilter: 'nearest' },
    })
    textures.push(result); uploadTexture(result, input); return result
  }
  const framebuffer = (target: Texture): Framebuffer => {
    const result = device.createFramebuffer({ width: target.width, height: target.height, colorAttachments: [target] }); fbos.push(result); return result
  }
  const readTexture = (target: Texture, onePixel = false): Float32Array => {
    const bytes = target.readDataSyncWebGL(onePixel ? { width: 1, height: 1 } : {})
    return bytes instanceof ArrayBuffer ? new Float32Array(bytes) : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  }
  const readCanvas = (onePixel = false): Uint8Array => readCanvasPixels(device, onePixel ? 1 : canvas.width, onePixel ? 1 : canvas.height)
  const encodeForce = (side: number, begin = false, end = false): void => {
    const model = springs[side]
    model.setBindings({ positionsTexture: positions[side], exitTexture: exit, sizeTexture: sizes, ...directionTextures[side] })
    const pass = device.beginRenderPass({
      framebuffer: forceFbos[side],
      clearColor: [0, 0, 0, 0],
      clearDepth: false,
      ...timestamps(begin, end),
    })
    try { model.draw(pass) } finally { pass.end() }
  }
  const draw = (positionIndex = 0, mode = 'both', verticesPerDraw = Infinity, begin = false, end = false): void => {
    const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false, ...timestamps(begin, end) })
    const drawRange = (model: Model, count: number, isLink: number): void => {
      renderUniforms.setUniforms({ renderUniforms: { pointSize, linkSize, isLink } })
      model.setBindings({ positions: positions[positionIndex], links })
      for (let first = 0; first < count; first += verticesPerDraw) {
        model.setVertexCount(Math.min(verticesPerDraw, count - first)); model.setDrawOffsets({ firstVertex: first, firstIndex: 0 })
        model.draw(pass)
      }
    }
    try {
      if (mode !== 'points') drawRange(renderLinks, topology.links.length, 1)
      if (mode !== 'links') drawRange(renderPoints, graph.points.length / 4, 0)
    } finally { pass.end() }
  }
  const integrateSide = (side: number, frozen = false, begin = false, end = false): void => {
    integrate.setBindings({ positionsTexture: positions[side], velocity: forces[side], pinnedStatusTexture: pinned, exitTexture: exit })
    const pass = device.beginRenderPass({
      framebuffer: positionFbos[side === 1 && frozen ? 2 : 1 - side],
      clearColor: [0, 0, 0, 0],
      clearDepth: false,
      ...timestamps(begin, end),
    })
    try { integrate.draw(pass) } finally { pass.end() }
  }
  const tick = (renderOutput: boolean, frozen = false, begin = false, end = false): void => {
    for (let side = 0; side < 2; side++) {
      if (onCheckpoint) checkpoint(`before ${side === 0 ? 'source' : 'target'} spring submission`)
      encodeForce(side, begin && side === 0)
      if (onCheckpoint) checkpoint(`after ${side === 0 ? 'source' : 'target'} spring submission`)
      integrateSide(side, frozen)
      if (onCheckpoint) checkpoint(`after ${side === 0 ? 'source' : 'target'} integration submission`)
    }
    if (renderOutput) draw(frozen ? 2 : 0, 'both', Infinity, false, end)
  }
  const encodeStage = (stage: Stage, begin: boolean, end: boolean): void => {
    if (stage === 'force') {
      encodeForce(0, begin); encodeForce(1, false, end)
    } else if (stage === 'integration') {
      integrateSide(0, true, begin); integrateSide(1, true, false, end)
    } else if (stage === 'render') draw(2, 'both', Infinity, begin, end)
    else tick(true, true, begin, end)
  }
  const backend: LinkBackend = {
    name: 'WebGL',
    get info (): string {
      return `${device.info.vendor} ${device.info.renderer}; luma-model-directional-v1; luma Model + UniformStore; ` +
        `directional springs (${stopAtDegree() ? 'early exit' : 'Cosmos bounds'})` +
        ` + integration; GPU timer ${hasTimer ? 'available' : 'unavailable'}`
    },
    setGraph (next: GraphInput, nextTopology: Topology, parameters: Parameters): SetupSubmission {
      phase = 'graph setup'
      assertHealthy()
      const started = performance.now(); uploadCallMs = 0
      clear(); graph = next; topology = nextTopology; params = parameters
      pointSize = Math.ceil(Math.sqrt(graph.points.length / 4))
      linkSize = Math.max(1, Math.ceil(Math.sqrt(topology.links.length / 2)))
      if (Math.max(pointSize, linkSize) > device.limits.maxTextureDimension2D) throw new Error('Graph exceeds WebGL texture limits')
      const springUniforms = new UniformStore(device, {
        forceLinkUniforms: {
          uniformTypes: {
            linkSpring: 'f32',
            linkDistance: 'f32',
            linkDistRandomVariationRange: 'vec2<f32>',
            linksTextureSize: 'f32',
            alpha: 'f32',
            collisionRadius: 'f32',
            collisionPadding: 'f32',
            useCollisionRadii: 'f32',
          },
        },
      })
      stores.push(springUniforms)
      // This luma version uploads setUniforms only after the managed buffer exists.
      springUniforms.getManagedUniformBuffer('forceLinkUniforms')
      springUniforms.setUniforms({
        forceLinkUniforms: {
          linkSpring: params.spring,
          linkDistance: params.distance,
          linkDistRandomVariationRange: params.variation,
          linksTextureSize: linkSize,
          alpha: params.alpha,
          collisionRadius: params.radius,
          collisionPadding: params.padding,
          useCollisionRadii: Number(params.collision),
        },
      })
      const makeQuad = (id: string, fs: string, bindings: Record<string, Buffer>): Model => {
        const model = new Model(device, {
          id,
          vs: quad,
          fs,
          topology: 'triangle-strip',
          vertexCount: 4,
          attributes: { vertexCoord: quadBuffer },
          bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
          defines: { USE_UNIFORM_BUFFERS: true },
          bindings,
          parameters: pipelineParameters,
        })
        models.push(model); return model
      }
      // Cosmos compiles each direction with its own adjacency maximum, not total point degree.
      springs = topology.directions.map((direction, side) => makeQuad(`spring-${side}`, springShader(direction.maxDegree, stopAtDegree()), {
        forceLinkUniforms: springUniforms.getManagedUniformBuffer('forceLinkUniforms'),
      }))
      const integrationUniforms = new UniformStore(device, { updatePositionUniforms: { uniformTypes: { friction: 'f32', maxStep: 'f32' } } })
      stores.push(integrationUniforms)
      integrationUniforms.getManagedUniformBuffer('updatePositionUniforms')
      integrationUniforms.setUniforms({ updatePositionUniforms: { friction: params.friction, maxStep: params.maxStep } })
      integrate = makeQuad('integrate', integrateSource, { updatePositionUniforms: integrationUniforms.getManagedUniformBuffer('updatePositionUniforms') })
      renderUniforms = new UniformStore(device, { renderUniforms: { uniformTypes: { pointSize: 'i32', linkSize: 'i32', isLink: 'i32' } } })
      stores.push(renderUniforms)
      const makeRender = (point: boolean): Model => {
        const model = new Model(device, {
          id: point ? 'points' : 'links',
          vs: renderVertex,
          fs: renderFragment,
          topology: point ? 'point-list' : 'line-list',
          vertexCount: 0,
          parameters: pipelineParameters,
          bindings: { renderUniforms: renderUniforms.getManagedUniformBuffer('renderUniforms') },
        })
        models.push(model); return model
      }
      renderPoints = makeRender(true); renderLinks = makeRender(false)
      positions = [texture(pointSize, graph.points), texture(pointSize, graph.points), texture(pointSize, graph.points)]
      forces = [texture(pointSize, new Float32Array()), texture(pointSize, new Float32Array())]
      positionFbos = positions.map(framebuffer); forceFbos = forces.map(framebuffer)
      const exitData = new Float32Array(graph.points.length); const pinnedData = exitData.slice(); const sizeData = exitData.slice()
      for (let i = 0; i < graph.points.length / 4; i++) {
        exitData[i * 4 + 1] = graph.points[i * 4 + 3]; pinnedData[i * 4] = graph.points[i * 4 + 2]; sizeData[i * 4] = graph.sizes[i]
      }
      exit = texture(pointSize, exitData); pinned = texture(pointSize, pinnedData); sizes = texture(pointSize, sizeData)
      const linkData = new Float32Array(topology.links.length * 2)
      for (let i = 0; i < topology.links.length / 2; i++) linkData.set(topology.links.subarray(i * 2, i * 2 + 2), i * 4)
      links = texture(linkSize, linkData)
      directionTextures = topology.directions.map(direction => {
        const info = new Float32Array(graph.points.length)
        for (let i = 0; i < graph.points.length / 4; i++) {
          info.set([direction.offsets[i] % linkSize, Math.floor(direction.offsets[i] / linkSize),
            direction.offsets[i + 1] - direction.offsets[i], 0], i * 4)
        }
        const indices = new Float32Array(direction.neighbors.length * 4); const random = indices.slice(); const properties = indices.slice()
        for (let i = 0; i < direction.neighbors.length; i++) {
          indices.set([direction.neighbors[i] % pointSize, Math.floor(direction.neighbors[i] / pointSize)], i * 4)
          properties.set(direction.properties.subarray(i * 4, i * 4 + 2), i * 4); random[i * 4] = direction.properties[i * 4 + 2]
        }
        return {
          linkInfoTexture: texture(pointSize, info),
          linkIndicesTexture: texture(linkSize, indices),
          linkPropertiesTexture: texture(linkSize, properties),
          linkRandomDistanceTexture: texture(linkSize, random),
        }
      })
      checkError()
      return { setupSubmitMs: performance.now() - started, uploadCallMs, directionalMaxDegrees: topology.directions.map(d => d.maxDegree) }
    },
    async synchronize (): Promise<void> {
      checkpoint(`before completion wait (${synchronization()})`)
      checkError()
      if (synchronization() === 'fence') await waitForWebGLFence(gl)
      else {
        readTexture(positions[0], true)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      checkpoint(`after completion wait (${synchronization()})`)
      checkError()
    },
    reset (): void {
      checkpoint('before resetting position textures')
      assertHealthy()
      for (const target of positions) uploadTexture(target, graph.points)
      checkpoint('after resetting position textures')
    },
    step (renderOutput = true): void {
      checkpoint('before simulation submission'); assertHealthy()
      tick(renderOutput); device.submit()
      checkpoint('after simulation submission')
    },
    render (): void { draw(); device.submit() },
    async diagnosePass (pass): Promise<Float32Array> {
      phase = `isolated ${pass}`
      checkError()
      const side = pass === 'firstForce' || pass === 'intermediate' ? 0 : 1
      const isForce = pass === 'firstForce' || pass === 'secondForce'
      if (isForce) encodeForce(side); else integrateSide(side)
      // Read the actual, complete output of this pass before submitting any later pass.
      device.submit()
      const data = readTexture(isForce ? forces[side] : positions[1 - side])
      await new Promise(resolve => setTimeout(resolve, 0))
      checkError()
      return data.slice(0, graph.points.length)
    },
    async diagnoseRender (progress, rows, cancelled): Promise<void> {
      const boundedImages = new Map<string, Uint8Array>()
      for (const verticesPerDraw of [4096, Infinity]) {
        for (const mode of ['points', 'links', 'both']) {
          if (cancelled()) return
          phase = `render-only ${mode}, ${verticesPerDraw} vertices/draw`
          progress(phase)
          await new Promise(resolve => setTimeout(resolve, 0))
          checkError()
          const start = performance.now()
          draw(0, mode, verticesPerDraw)
          device.submit()
          const pixels = readCanvas()
          const completionMs = performance.now() - start
          await new Promise(resolve => setTimeout(resolve, 0))
          checkError()
          let checksum = 2166136261; let coloredPixels = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 40) coloredPixels++
            for (let c = 0; c < 4; c++) checksum = Math.imul(checksum ^ pixels[i + c], 16777619) >>> 0
          }
          if (Number.isFinite(verticesPerDraw)) boundedImages.set(mode, pixels)
          const matchesBounded = pixels.every((value, index) => value === boundedImages.get(mode)![index])
          rows.push({
            mode,
            verticesPerDraw: Number.isFinite(verticesPerDraw) ? verticesPerDraw : 0,
            completionMs,
            checksum,
            coloredPixels,
            matchesBounded,
          })
        }
      }
    },
    async read (frozen = false): Promise<Snapshot> {
      checkpoint('before full snapshot readback')
      assertHealthy()
      const read = (target: Texture, label: string): Float32Array => {
        checkpoint(`before ${label} readPixels`)
        assertHealthy()
        const data = readTexture(target)
        checkpoint(`after ${label} readPixels`)
        checkError()
        return data.slice(0, graph.points.length)
      }
      const snapshot = {
        firstForce: read(forces[0], 'source force'),
        intermediate: read(positions[1], 'source positions'),
        secondForce: read(forces[1], 'target force'),
        positions: read(positions[frozen ? 2 : 0], 'final positions'),
      }
      // A GPU reset can be reported only after the read returns and the browser processes events.
      await new Promise(resolve => setTimeout(resolve, 0))
      checkpoint('after snapshot readback event-loop yield')
      checkError()
      return snapshot
    },
    async measure (stage: Stage, operations = 1): Promise<Measurement> {
      phase = `${stage} preparation (${operations} operations)`
      assertHealthy()
      if (!Number.isInteger(operations) || operations < 1 || operations > TIMING_POLICY.maxOperations) throw new Error('Invalid batch size')
      backend.reset(); tick(false, true); device.submit()
      readTexture(positions[2], true); checkError()
      activeTimer = hasTimer ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined
      phase = `${stage} batch (${operations} operations)`
      try {
        const start = performance.now()
        for (let i = 0; i < operations; i++) encodeStage(stage, i === 0, i === operations - 1)
        device.submit()
        const submitted = performance.now()
        // Completion readback remains outside the timestamp interval.
        if (stage === 'tick' || stage === 'render') readCanvas(true)
        else readTexture(stage === 'force' ? forces[1] : positions[2], true)
        const complete = performance.now(); checkError()
        const result = activeTimer ? await readLumaTimer(activeTimer) : { milliseconds: null, status: 'unavailable' as const }
        checkError()
        return normalizeMeasurement(stage, operations, submitted - start, complete - start, result.milliseconds, result.status)
      } finally { activeTimer?.destroy(); activeTimer = undefined }
    },
    destroy (): void { canvas.removeEventListener('webglcontextlost', contextLost); clear(); quadBuffer.destroy(); device.destroy() },
  }
  return backend
}
