import { Texture, UniformStore, type Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { forceFrag } from '../../../../../src/modules/ForceLink/force-spring'
import gravitySource from '../../../../../src/modules/ForceGravity/force-gravity.frag?raw'
import quadSource from '../../../../../src/modules/Shared/quad.vert?raw'
import { createGridWebGL } from '../many-body-grid/webgl'
import { frameFor } from '../many-body-grid/data'
import type { Input } from '../many-body/data'
import { buildTopology, type GraphInput } from '../weighted-links/data'
import { GRAVITY, REPULSION, SPRINGS, type Stage } from './data'
import type { CombinedBackend } from './backend'
import { repulsionMethod, type RepulsionPolicy } from './repulsion-policy'
import { forceSettings, validateForceSettings, type ForceSettings } from './production-settings'
export async function createCombinedWebGL (
  canvas: HTMLCanvasElement, graph: GraphInput, input: Input,
  options: { forceSettings?: ForceSettings; repulsionPolicy?: RepulsionPolicy; adaptiveSampling?: boolean } = {}
): Promise<CombinedBackend> {
  const settings = options.forceSettings ?? forceSettings('reference', input.points.length / 4); validateForceSettings(settings)
  const policy = options.repulsionPolicy ?? 'hierarchical'
  let stage: Stage = 'gravity'; const p = { ...REPULSION }; const topology = buildTopology(graph)
  const base = await createGridWebGL(canvas, input, p, frameFor(input.points, 0, settings.samples, settings.precise), gridFactory => resources => {
    const { device, positions, target, exit, size, count } = resources
    const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const grid = own(gridFactory(resources))
      const texture = (width: number, data: Float32Array): Texture => {
        const t = own(device.createTexture({
          width,
          height: width,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.COPY_DST,
          sampler: { minFilter: 'nearest', magFilter: 'nearest' },
        }))
        const padded = new Float32Array(width * width * 4); padded.set(data)
        t.copyImageData({ data: padded, bytesPerRow: width * 16 }); return t
      }
      const linkSize = Math.max(1, Math.ceil(Math.sqrt(graph.links.length / 2)))
      const directions = topology.directions.map(d => {
        const info = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) info.set([d.offsets[i] % linkSize, Math.floor(d.offsets[i] / linkSize), d.offsets[i + 1] - d.offsets[i], 0], i * 4)
        const indices = new Float32Array(d.neighbors.length * 4); const properties = indices.slice(); const random = indices.slice()
        for (let i = 0; i < d.neighbors.length; i++) {
          indices.set([d.neighbors[i] % size, Math.floor(d.neighbors[i] / size)], i * 4)
          properties.set(d.properties.subarray(i * 4, i * 4 + 2), i * 4); random[i * 4] = d.properties[i * 4 + 2]
        }
        return {
          linkInfoTexture: texture(size, info),
          linkIndicesTexture: texture(linkSize, indices),
          linkPropertiesTexture: texture(linkSize, properties),
          linkRandomDistanceTexture: texture(linkSize, random),
        }
      })
      const gravityUniforms = own(new UniformStore(device, {
        forceGravityUniforms: {
          uniformTypes: { gravity: 'f32', worldOrigin: 'vec2<f32>', alpha: 'f32' },
        },
      }))
      const springUniforms = own(new UniformStore(device, {
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
      }))
      const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
      const model = (fs: string, bindings: Record<string, Buffer>): Model => own(new Model(device, {
        vs: quadSource,
        fs,
        defines: { USE_UNIFORM_BUFFERS: true },
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: { vertexCoord: quad },
        bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
        bindings,
        parameters: { blend: false, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' },
      }))
      const gravity = model(gravitySource, { forceGravityUniforms: gravityUniforms.getManagedUniformBuffer('forceGravityUniforms') })
      const springs = topology.directions.map(d => model(forceFrag(d.maxDegree), {
        forceLinkUniforms: springUniforms.getManagedUniformBuffer('forceLinkUniforms'),
      }))
      const drawUniforms = own(new UniformStore(device, { drawUniforms: { uniformTypes: { view: 'vec4<f32>' } } }))
      const linkIndices = new Float32Array(topology.links.length * 2)
      for (const [i, point] of topology.links.entries()) linkIndices.set([point % size, Math.floor(point / size)], i * 2)
      const indices = own(device.createBuffer({ data: linkIndices }))
      const lines = own(new Model(device, {
        vs: `#version 300 es
precision highp float;
in vec2 pointIndex; uniform sampler2D positions;
layout(std140) uniform drawUniforms { vec4 view; };
void main() { vec2 p = texelFetch(positions, ivec2(pointIndex), 0).xy; gl_Position = vec4((p - view.xy) * view.zw,0.,1.); }`,
        fs: `#version 300 es
precision highp float;
out vec4 color; void main() { color = vec4(0.27,0.32,0.4,1.); }`,
        topology: 'line-list',
        vertexCount: topology.links.length,
        attributes: { pointIndex: indices },
        bufferLayout: [{ name: 'pointIndex', format: 'float32x2' }],
        bindings: { drawUniforms: drawUniforms.getManagedUniformBuffer('drawUniforms') },
        parameters: { blend: false, depthWriteEnabled: false, depthCompare: 'always' },
      }))
      return {
        render (source, view, pass): void {
          drawUniforms.setUniforms({ drawUniforms: { view } }); lines.setBindings({ positions: positions[source] }); lines.draw(pass)
        },
        encode (source): void {
          if (stage === 'repulsion') {
            if (repulsionMethod(count, policy) === 'exact') resources.encodeExact()
            else grid.encode(source)
            return
          }
          let active: Model
          if (stage === 'gravity') {
            gravityUniforms.setUniforms({ forceGravityUniforms: { gravity: GRAVITY, worldOrigin: settings.origin ?? [0, 0], alpha: p.alpha } })
            active = gravity; active.setBindings({ positionsTexture: positions[source] })
          } else {
            const side = stage === 'incoming' ? 0 : 1
            springUniforms.setUniforms({
              forceLinkUniforms: {
                linkSpring: SPRINGS.spring,
                linkDistance: SPRINGS.distance,
                linkDistRandomVariationRange: settings.variation,
                linksTextureSize: linkSize,
                alpha: p.alpha,
                collisionRadius: 0,
                collisionPadding: 0,
                useCollisionRadii: 0,
              },
            })
            active = springs[side]; active.setBindings({
              positionsTexture: positions[source],
              exitTexture: exit,
              sizeTexture: exit,
              ...directions[side],
            })
          }
          const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
          try { active.draw(pass) } finally { pass.end() }
        },
        destroy (): void { owned.reverse().forEach(r => r.destroy()) },
      }
    } catch (error) { owned.reverse().forEach(r => r.destroy()); throw error }
  }, options.adaptiveSampling ? 64 : settings.samples)
  return {
    ...base,
    repulsionMethod: () => repulsionMethod(input.points.length / 4, policy),
    async readStructure (): ReturnType<CombinedBackend['readStructure']> {
      if (repulsionMethod(input.points.length / 4, policy) === 'exact') throw new Error('Exact repulsion does not build a grid')
      return base.readStructure()
    },
    stepStage (next, alpha): void { stage = next; p.alpha = alpha; base.step() },
  }
}
