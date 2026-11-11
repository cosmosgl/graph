import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload, createStorageRenderer } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { WebGPUOptions } from '../many-body/webgpu'
import type { Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'
import { validateBatch } from '../many-body/timing'
import springSource from '../weighted-links/force.wgsl?raw'
import { createGridWebGPU } from '../many-body-grid/webgpu'
import { frameFor } from '../many-body-grid/data'
import { createLinkResources } from './topology'
import { measureFrameBatch } from './frame-timing'
import { cool, GRAVITY, REPULSION, SPRINGS, STAGES, type SpringPrecision, type Stage } from './data'
import { polarGravitySource, refinedGravitySource } from './gravity-source'
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
  canvas: HTMLCanvasElement, graph: GraphInput, input: Input, precision: SpringPrecision = 'baseline',
  overrides: WebGPUOptions & { roundedStages?: readonly Stage[]; polarGravity?: boolean; refinedTrig?: boolean; gpuBounds?: boolean } = {}
): Promise<CombinedBackend> {
  const roundedStages = overrides.roundedStages ?? []
  const polarGravity = overrides.polarGravity ?? (precision === 'aligned' || precision === 'trig')
  const refinedTrig = overrides.refinedTrig ?? precision === 'trig'
  let stage: Stage = 'gravity'; const p = { ...REPULSION }
  let nextGraph: GraphInput | undefined
  let device: Device; let replaceLinks: NonNullable<CombinedBackend['replaceLinks']>
  const base = await createGridWebGPU(canvas, input, p, frameFor(input.points, 0), 'streamed', gridFactory => async resources => {
    const { positions, forces } = resources; let count = resources.count
    device = resources.device
    const scope = resourceScope(overrides.context?.ledger); const own = scope.own
    try {
      const grid = own(await gridFactory(resources))
      const gravityParams = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      const springParams = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
      let linkResources = createLinkResources(device, input.points, graph, overrides.context?.ledger); let version = 0
      own({ destroy: () => linkResources.destroy() })
      replaceLinks = (next): ReturnType<NonNullable<CombinedBackend['replaceLinks']>> => {
        const replacement = createLinkResources(device, input.points, next, overrides.context?.ledger)
        const previous = linkResources; linkResources = replacement; version++
        previous.destroy()
        return { version, bytes: replacement.bytes, edgeCount: replacement.edgeCount, buildMs: replacement.buildMs }
      }
      const viewBuffer = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      const lines = own(createStorageRenderer(device, linkSource, 'line-list', bindingLayout([
        ['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['view', 'uniform'],
      ])))
      const gravityBindings = bindingLayout([
        ['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
      ])
      const gravity = own(polarGravity
        ? await createRoundedKernel(device, refinedTrig ? refinedGravitySource : polarGravitySource, gravityBindings)
        : await Kernel.createAsync(device, { source: gravitySource, shaderLayout: { bindings: gravityBindings } }))
      const springBindings = bindingLayout([
        ['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['edges', 'read-only-storage'],
        ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
      ])
      const roundedProducts = precision === 'products' || precision === 'composed' || precision === 'aligned' || precision === 'trig'
      const roundSpring = ['integration', 'both', 'refined', 'distance', 'products', 'composed', 'aligned', 'trig'].includes(precision)
      const extraStages = precision === 'trig'
        ? [...roundedStages, 'gravity', 'repulsion']
        : precision === 'composed' || precision === 'aligned' ? [...roundedStages, 'repulsion'] : roundedStages
      const spring = own(precision === 'force' || precision === 'both' || precision === 'refined'
        ? await createRoundedKernel(device, roundedSpringSource(precision === 'refined'), springBindings)
        : await Kernel.createAsync(device, {
          source: roundedProducts ? distanceSpringSource('products') : precision === 'distance' ? distanceSpringSource() : springSource,
          shaderLayout: { bindings: springBindings },
        }))
      const integrationParams = own(upload(device, new Float32Array([count, 0, 0, 0, p.friction, p.referenceLength, 0, 0]), Buffer.UNIFORM))
      const integration = roundSpring || extraStages.length > 0
        ? own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ])))
        : undefined
      return {
        resize (next): void {
          if (!nextGraph) throw new Error('Use resizeGraph to update composed resources')
          linkResources.update(next.points, nextGraph)
          grid.resize!(next)
          count = next.points.length / 4; input = next
          integrationParams.write(new Float32Array([count, 0, 0, 0, p.friction, p.referenceLength, 0, 0]))
        },
        integrate (source, timing, sharedPass): boolean {
          const rounded = (roundSpring && (stage === 'incoming' || stage === 'outgoing')) || extraStages.includes(stage)
          if (!integration || !rounded) return false
          const pass = sharedPass ?? device.beginComputePass(timing)
          try {
            integration.dispatch(pass, {
              x: Math.ceil(count / 64),
              bindings: {
                positions: positions[source], forces, params: integrationParams, output: positions[1 - source],
              },
            })
          } finally { if (!sharedPass) pass.end() }
          return true
        },
        render (source, view, pass): void {
          viewBuffer.write(new Float32Array(view))
          lines.kernel.draw(pass, {
            vertexArray: lines.vertexArray,
            vertexCount: linkResources.edgeCount * 2,
            bindings: { positions: positions[source], links: linkResources.links, view: viewBuffer },
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
        encode (source, timing, sharedPass): void {
          if (stage === 'repulsion') { grid.encode(source, timing, sharedPass); return }
          const pass = sharedPass ?? device.beginComputePass(timing)
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
                  positions: positions[source],
                  offsets: linkResources.offsets[side],
                  edges: linkResources.edges[side],
                  sizes: linkResources.sizes,
                  params: springParams,
                  forces,
                },
              })
            }
          } finally { if (!sharedPass) pass.end() }
        },
        destroy: scope.destroy,
      }
    } catch (error) { scope.destroy(); throw error }
  }, { gpuBounds: overrides.gpuBounds, context: overrides.context, preserve: overrides.preserve })
  return {
    ...base,
    resizeGraph (graph, input, preserve): ReturnType<NonNullable<CombinedBackend['resizeGraph']>> {
      nextGraph = graph
      try { return base.resizeInput!(input, preserve) } finally { nextGraph = undefined }
    },
    replaceLinks: (next): ReturnType<NonNullable<CombinedBackend['replaceLinks']>> => { base.resourceIdentity!(); return replaceLinks(next) },
    measureCurrentFrame: overrides.gpuBounds
      ? async (alpha, tick, view): ReturnType<NonNullable<CombinedBackend['measureCurrentFrame']>> => {
        base.resourceIdentity!()
        const timing = await measureFrameBatch(device, 1, 2, (query) => {
          base.setGpuFrame!(tick)
          const pass = device.beginComputePass(query ? { timestampQuerySet: query, beginTimestampIndex: 0, endTimestampIndex: 1 } : {})
          try {
            for (const next of STAGES) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
          } finally { pass.end() }
          base.render(view, query ? { timestampQuerySet: query, beginTimestampIndex: 2, endTimestampIndex: 3 } : {}, false)
        }).catch(error => { base.resourceIdentity!(); throw error })
        return { timing, snapshot: await base.read() }
      }
      : undefined,
    measureFrames: overrides.gpuBounds
      ? async ({ frames, draw, decay, view }): ReturnType<NonNullable<CombinedBackend['measureFrames']>> => {
        validateBatch(frames)
        if (!Number.isInteger(decay) || decay < 1) throw new Error('Invalid cooling schedule')
        base.setPositions(input.points)
        let alpha = 1; let tick = 0
        const timing = await measureFrameBatch(device, frames, draw ? 2 : 1, (query, frame) => {
          base.setGpuFrame!(tick)
          const index = frame * (draw ? 4 : 2)
          const pass = device.beginComputePass(query ? { timestampQuerySet: query, beginTimestampIndex: index, endTimestampIndex: index + 1 } : {})
          try {
            for (const next of STAGES) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
          } finally { pass.end() }
          if (draw) {
            base.render(view, query
              ? {
                timestampQuerySet: query, beginTimestampIndex: index + 2, endTimestampIndex: index + 3,
              }
              : {}, false)
          }
          tick++; alpha = cool(alpha, decay)
        }).catch(error => { base.resourceIdentity!(); throw error })
        return { timing, snapshot: await base.read() }
      }
      : undefined,
    stepTick: overrides.gpuBounds
      ? (alpha, tick): void => {
        base.setGpuFrame!(tick)
        const pass = device.beginComputePass()
        try {
          for (const next of STAGES) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
        } finally { pass.end() }
        device.submit()
      }
      : undefined,
    stepStage (next, alpha): void { stage = next; p.alpha = alpha; base.step() },
    measureStage (next, alpha, phase, operations): ReturnType<typeof base.measure> {
      stage = next; p.alpha = alpha
      return base.measure(phase, operations)
    },
    measureSpring (next, alpha, phase, operations): ReturnType<typeof base.measure> {
      stage = next; p.alpha = alpha
      return base.measure(phase, operations)
    },
  }
}
