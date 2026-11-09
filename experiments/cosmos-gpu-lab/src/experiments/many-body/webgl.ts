import { Texture, UniformStore, type Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import quadSource from '../../../../../src/modules/Shared/quad.vert?raw'
import forceSource from '../../../../../src/modules/ForceManyBody/force-allpairs.frag?raw'
import integrationSource from '../../../../../src/modules/Points/update-position.frag?raw'
import { createDevice } from '../../gpu/luma'
import type { Backend } from './backend'
import type { Snapshot } from './reference'
import { nearLimit, validateInput, type Input, type Parameters } from './data'

const parameters = { blend: false, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' } as const
const vertex = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D positions;
layout(std140) uniform drawUniforms { vec4 view; float size; };
out vec3 color;
void main() {
  vec4 p = texelFetch(positions, ivec2(gl_VertexID % int(size), gl_VertexID / int(size)), 0);
  gl_Position = vec4(3.,3.,0.,1.);
  if (p.w <= 0.5) gl_Position = vec4((p.xy - view.xy) * view.zw,0.,1.);
  gl_PointSize = 5.;
  color = p.z > 0.5 ? vec3(1.,0.72,0.4) : vec3(0.62,0.71,0.84);
}`
const fragment = `#version 300 es
precision highp float;
in vec3 color; out vec4 fragColor;
void main() { if (length(gl_PointCoord * 2. - 1.) > 1.) discard; fragColor = vec4(color,1.); }`

export async function createWebGL (canvas: HTMLCanvasElement, input: Input, p: Parameters): Promise<Backend> {
  validateInput(input, p)
  let failure: string | undefined
  const device = await createDevice('webgl', canvas, false, error => { failure = error.message })
  const owned: Array<{ destroy(): void }> = []
  const own = <T extends { destroy(): void }>(resource: T): T => { owned.push(resource); return resource }
  const healthy = (): void => { if (failure || device.isLost) throw new Error(failure ?? 'WebGL context lost') }
  try {
    if (!device.isTextureFormatRenderable('rgba32float')) throw new Error('RGBA32F rendering unavailable')
    const count = input.points.length / 4; const size = Math.max(1, Math.ceil(Math.sqrt(count)))
    const upload = (target: Texture, data: Float32Array): void => {
      const padded = new Float32Array(size * size * 4); padded.set(data)
      target.copyImageData({ data: padded, bytesPerRow: size * 16, mipLevel: 0, x: 0, y: 0 })
    }
    const texture = (data: Float32Array): Texture => {
      const target = own(device.createTexture({
        width: size,
        height: size,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC | Texture.COPY_DST,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      }))
      upload(target, data); return target
    }
    const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
    const makeQuad = (id: string, fs: string, bindings: Record<string, Buffer>): Model => own(new Model(device, {
      id,
      vs: quadSource,
      fs,
      defines: { USE_UNIFORM_BUFFERS: true },
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: quad },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      bindings,
      parameters,
    }))
    const forceUniforms = own(new UniformStore(device, {
      forceAllPairsUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32', pointsNumber: 'f32', alpha: 'f32', repulsion: 'f32', maxStep: 'f32',
        },
      },
    }))
    const force = makeQuad('cosmos-allpairs', forceSource, { forceAllPairsUniforms: forceUniforms.getManagedUniformBuffer('forceAllPairsUniforms') })
    forceUniforms.setUniforms({
      forceAllPairsUniforms: {
        pointsTextureSize: size, pointsNumber: count, alpha: p.alpha, repulsion: p.repulsion, maxStep: nearLimit(count, p),
      },
    })
    const integrateUniforms = own(new UniformStore(device, { updatePositionUniforms: { uniformTypes: { friction: 'f32', maxStep: 'f32' } } }))
    const integrate = makeQuad('cosmos-integrate', integrationSource, {
      updatePositionUniforms: integrateUniforms.getManagedUniformBuffer('updatePositionUniforms'),
    })
    integrateUniforms.setUniforms({ updatePositionUniforms: { friction: p.friction, maxStep: p.referenceLength } })
    const drawUniforms = own(new UniformStore(device, { drawUniforms: { uniformTypes: { view: 'vec4<f32>', size: 'f32' } } }))
    const draw = own(new Model(device, {
      id: 'allpairs-points',
      vs: vertex,
      fs: fragment,
      topology: 'point-list',
      vertexCount: count,
      bindings: { drawUniforms: drawUniforms.getManagedUniformBuffer('drawUniforms') },
      parameters,
    }))
    const positions = [texture(input.points), texture(input.points)]
    const forces = texture(new Float32Array())
    const randomData = new Float32Array(input.points.length)
    const exitData = new Float32Array(input.points.length); const pinnedData = new Float32Array(input.points.length)
    for (let i = 0; i < count; i++) {
      randomData.set(input.samples.subarray(i * 2, i * 2 + 2), i * 4)
      exitData[i * 4 + 1] = input.points[i * 4 + 3]; pinnedData[i * 4] = input.points[i * 4 + 2]
    }
    const random = texture(randomData); const exit = texture(exitData); const pinned = texture(pinnedData)
    const targets = [...positions, forces].map(target => own(device.createFramebuffer({ width: size, height: size, colorAttachments: [target] })))
    const read = (target: Texture): Float32Array => {
      const data = target.readDataSyncWebGL()
      const floats = data instanceof ArrayBuffer ? new Float32Array(data) : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
      return floats.slice(0, input.points.length)
    }
    let current = 0; let destroyed = false
    healthy()
    return {
      name: 'WebGL',
      info: `${device.info.vendor} ${device.info.renderer}; production GLSL through luma v10 Model / UniformStore`,
      setPositions (data): void {
        healthy()
        if (data.length !== input.points.length) throw new Error('Point count changed; recreate the backend')
        positions.forEach(target => upload(target, data)); current = 0
      },
      step (): void {
        healthy()
        if (!count) return
        force.setBindings({ positionsTexture: positions[current], randomValues: random, exitTexture: exit })
        const forcePass = device.beginRenderPass({ framebuffer: targets[2], clearColor: [0, 0, 0, 0], clearDepth: false })
        try { force.draw(forcePass) } finally { forcePass.end() }
        integrate.setBindings({ positionsTexture: positions[current], velocity: forces, pinnedStatusTexture: pinned, exitTexture: exit })
        const pass = device.beginRenderPass({ framebuffer: targets[1 - current], clearColor: [0, 0, 0, 0], clearDepth: false })
        try { integrate.draw(pass) } finally { pass.end() }
        current = 1 - current; device.submit(); healthy()
      },
      async read (): Promise<Snapshot> {
        healthy()
        const result = { forces: read(forces), positions: read(positions[current]) }
        // Let asynchronous context-loss / luma errors surface before reporting success.
        await new Promise(resolve => setTimeout(resolve, 0)); healthy(); return result
      },
      render (view): void {
        healthy(); drawUniforms.setUniforms({ drawUniforms: { view, size } }); draw.setBindings({ positions: positions[current] })
        const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false })
        try { if (count) draw.draw(pass) } finally { pass.end() }
        device.submit()
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        try { owned.reverse().forEach(resource => resource.destroy()) } finally { device.destroy() }
      },
    }
  } catch (error) {
    try { owned.reverse().forEach(resource => resource.destroy()) } finally { device.destroy() }
    throw error
  }
}
