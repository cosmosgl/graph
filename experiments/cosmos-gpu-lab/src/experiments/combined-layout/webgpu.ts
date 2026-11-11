import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload, createStorageRenderer } from '../../gpu/luma'
import type { Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'
import { buildTopology } from '../weighted-links/data'
import springSource from '../weighted-links/force.wgsl?raw'
import { createGridWebGPU } from '../many-body-grid/webgpu'
import { frameFor } from '../many-body-grid/data'
import { GRAVITY, REPULSION, SPRINGS, type SpringPrecision, type Stage } from './data'
import type { CombinedBackend } from './backend'
import { createRoundedKernel, roundedSpringSource, roundedIntegrationSource, distanceSpringSource } from './spring-precision'
const gravitySource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: vec4<f32>;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u32(params.x)) { return; }
  // The production polar expression is a linear spring toward the origin.
  forces[id.x] = vec4(-positions[id.x].xy * (params.y * params.z * 0.1), 0., 0.);
}`
const linkSource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> links: array<u32>;
@group(0) @binding(2) var<uniform> view: vec4<f32>;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4((positions[links[i]].xy - view.xy) * view.zw, 0., 1.);
}
@fragment fn fragmentMain() -> @location(0) vec4<f32> { return vec4(0.27,0.32,0.4,1.); }
`
export async function createCombinedWebGPU (
  canvas: HTMLCanvasElement, graph: GraphInput, input: Input, precision: SpringPrecision = 'baseline'
): Promise<CombinedBackend> {
  let stage: Stage = 'gravity'; const p = { ...REPULSION }; const topology = buildTopology(graph)
  const base = await createGridWebGPU(canvas, input, p, frameFor(input.points, 0), 'streamed', gridFactory => async resources => {
    const { device, positions, forces, count } = resources
    const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const grid = own(await gridFactory(resources))
      const gravityParams = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      const springParams = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
      const sizes = own(upload(device, graph.sizes))
      const links = own(upload(device, topology.links))
      const viewBuffer = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      const lines = own(createStorageRenderer(device, linkSource, 'line-list', bindingLayout([
        ['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['view', 'uniform'],
      ])))
      const offsets = topology.directions.map(d => own(upload(device, d.offsets)))
      const edges = topology.directions.map(d => {
        const data = new ArrayBuffer(d.neighbors.length * 16); const ints = new Uint32Array(data); const floats = new Float32Array(data)
        for (let i = 0; i < d.neighbors.length; i++) { ints[i * 4] = d.neighbors[i]; floats.set(d.properties.subarray(i * 4, i * 4 + 3), i * 4 + 1) }
        return own(upload(device, new Uint8Array(data)))
      })
      const gravity = own(await Kernel.createAsync(device, {
        source: gravitySource,
        shaderLayout: {
          bindings: bindingLayout([
            ['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
          ]),
        },
      }))
      const springBindings = bindingLayout([
        ['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['edges', 'read-only-storage'],
        ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
      ])
      const spring = own(precision === 'force' || precision === 'both' || precision === 'refined'
        ? await createRoundedKernel(device, roundedSpringSource(precision === 'refined'), springBindings)
        : await Kernel.createAsync(device, {
          source: precision === 'distance' ? distanceSpringSource() : springSource, shaderLayout: { bindings: springBindings },
        }))
      const integrationParams = own(upload(device, new Float32Array([count, 0, 0, 0, p.friction, p.referenceLength, 0, 0]), Buffer.UNIFORM))
      const integration = precision === 'integration' || precision === 'both' || precision === 'refined' || precision === 'distance'
        ? own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ])))
        : undefined
      return {
        integrate (source, timing): boolean {
          if (!integration || (stage !== 'incoming' && stage !== 'outgoing')) return false
          const pass = device.beginComputePass(timing)
          try {
            integration.dispatch(pass, {
              x: Math.ceil(count / 64),
              bindings: {
                positions: positions[source], forces, params: integrationParams, output: positions[1 - source],
              },
            })
          } finally { pass.end() }
          return true
        },
        render (source, view, pass): void {
          viewBuffer.write(new Float32Array(view))
          lines.kernel.draw(pass, {
            vertexArray: lines.vertexArray,
            vertexCount: topology.links.length,
            bindings: { positions: positions[source], links, view: viewBuffer },
          })
        },
        prepare (): void {
          if (stage === 'repulsion') grid.prepare?.()
          else if (stage === 'gravity') gravityParams.write(new Float32Array([count, p.alpha, GRAVITY, 0]))
          else {
            springParams.write(new Float32Array([SPRINGS.spring, SPRINGS.distance, ...SPRINGS.variation, p.alpha,
              SPRINGS.friction, SPRINGS.maxStep, 0, 0, 0, count, 0]))
          }
        },
        encode (source, timing): void {
          if (stage === 'repulsion') { grid.encode(source, timing); return }
          const pass = device.beginComputePass(timing)
          try {
            if (stage === 'gravity') {
              gravity.dispatch(pass, {
                x: Math.ceil(count / 64),
                bindings: { positions: positions[source], params: gravityParams, forces },
              })
            } else {
              const side = stage === 'incoming' ? 0 : 1
              spring.dispatch(pass, {
                x: Math.ceil(count / 64),
                bindings: {
                  positions: positions[source], offsets: offsets[side], edges: edges[side], sizes, params: springParams, forces,
                },
              })
            }
          } finally { pass.end() }
        },
        destroy (): void { owned.reverse().forEach(r => r.destroy()) },
      }
    } catch (error) { owned.reverse().forEach(r => r.destroy()); throw error }
  })
  return {
    ...base,
    stepStage (next, alpha): void { stage = next; p.alpha = alpha; base.step() },
    measureSpring (next, alpha, phase, operations): ReturnType<typeof base.measure> {
      stage = next; p.alpha = alpha
      return base.measure(phase, operations)
    },
  }
}
