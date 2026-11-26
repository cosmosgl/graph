import { Texture, UniformStore, type Device, type Framebuffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { resourceScope } from '../../gpu/resource-scope'
import aggregateVert from '../../../../../src/modules/ForceCenter/calculate-centermass.vert?raw'
import aggregateFrag from '../../../../../src/modules/ForceCenter/calculate-centermass.frag?raw'
import forceFrag from '../../../../../src/modules/ForceCenter/force-center.frag?raw'
import quadVert from '../../../../../src/modules/Shared/quad.vert?raw'
export function createCenterWebGL (device: Device, count: number, size: number, positions: Texture[], exit: Texture, target: Framebuffer): {
  encode(source: number, alpha: number, strength: number): void; read(): Promise<Float32Array>; destroy(): void;
} {
  const scope = resourceScope(); const own = scope.own
  try {
    const result = own(device.createTexture({
      width: 1,
      height: 1,
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC,
      sampler: { minFilter: 'nearest', magFilter: 'nearest' },
    }))
    const framebuffer = own(device.createFramebuffer({ width: 1, height: 1, colorAttachments: [result] }))
    const indices = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) indices.set([i % size, Math.floor(i / size)], i * 2)
    const pointIndices = own(device.createBuffer({ data: indices }))
    const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
    const uniforms = own(new UniformStore(device, { forceCenterUniforms: { uniformTypes: { centerForce: 'f32', alpha: 'f32' } } }))
    const base = { depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' } as const
    const aggregate = own(new Model(device, {
      vs: aggregateVert,
      fs: aggregateFrag,
      topology: 'point-list',
      vertexCount: count,
      attributes: { pointIndices },
      bufferLayout: [{ name: 'pointIndices', format: 'float32x2' }],
      parameters: {
        ...base,
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one',
      },
    }))
    const force = own(new Model(device, {
      vs: quadVert,
      fs: forceFrag,
      defines: { USE_UNIFORM_BUFFERS: true },
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: { vertexCoord: quad },
      bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
      bindings: { forceCenterUniforms: uniforms.getManagedUniformBuffer('forceCenterUniforms') },
      parameters: { ...base, blend: false },
    }))
    return {
      encode (source, alpha, strength): void {
        aggregate.setBindings({ positionsTexture: positions[source], exitTexture: exit })
        const sum = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
        try { aggregate.draw(sum) } finally { sum.end() }
        uniforms.setUniforms({ forceCenterUniforms: { centerForce: strength, alpha } })
        force.setBindings({ positionsTexture: positions[source], centermassTexture: result })
        const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
        try { force.draw(pass) } finally { pass.end() }
      },
      async read (): Promise<Float32Array> {
        const data = result.readDataSyncWebGL()
        return data instanceof ArrayBuffer ? new Float32Array(data) : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
