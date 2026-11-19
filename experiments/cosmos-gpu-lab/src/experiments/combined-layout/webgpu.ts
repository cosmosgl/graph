import { Buffer, type Device, type ComputePass } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { graphRgb } from '../../runtime/palette'
import { bindingLayout, upload, createStorageRenderer, readFloats } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { WebGPUOptions } from '../many-body/webgpu'
import { nearLimit, type Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'
import { validateBatch } from '../many-body/timing'
import springSource from '../weighted-links/force.wgsl?raw'
import { createGridWebGPU } from '../many-body-grid/webgpu'
import { frameFor } from '../many-body-grid/data'
import { replaceOnce } from '../many-body-grid/trace'
import type { AggregationMode } from '../many-body-grid/aggregation'
import { createCollisionWebGPU } from '../collision/webgpu'
import { COLLISION_EXACT_LIMIT, validateSizes, type CollisionArithmetic } from '../collision/data'
import { collisionPassFrame } from '../collision/hashed-grid'
import { createCollisionSlotsWebGPU } from '../collision/hashed-webgpu'
import { createClusterWebGPU } from '../cluster-attraction/webgpu'
import { SETTINGS as CLUSTER, type ClusterInput } from '../cluster-attraction/data'
import { createAttractorWebGPU } from '../point-attractors/webgpu'
import { packAttractors, SETTINGS as ATTRACTOR, type AttractorInput } from '../point-attractors/data'
import { pointerUniform, type Vector } from '../mouse-repulsion/data'
import { createMouseWebGPU, type MouseArithmetic } from '../mouse-repulsion/webgpu'
import { createLinkResources } from './topology'
import { measureFrameBatch } from './frame-timing'
import { measureGpuStages } from './stage-timing'
import { cool, GRAVITY, REPULSION, SPRINGS, stagesFor, type SpringPrecision, type Stage } from './data'
import { createCenterWebGPU } from './center-webgpu'
import { DEFAULT_CENTER_REDUCTION } from './center-reduction'
import { polarGravitySource, refinedGravitySource } from './gravity-source'
import type { CombinedBackend } from './backend'
import { createRoundedKernel, roundedSpringSource, roundedIntegrationSource, distanceSpringSource } from './spring-precision'
import { HUB_THRESHOLD, hoistedSpringSource, prefetchSpringSources, type SpringOptimization } from './hub-spring-source'
import { strictExactShader } from './exact-shader'
import { repulsionMethod, type RepulsionPolicy } from './repulsion-policy'
import { forceSettings, validateForceSettings, type ForceSettings } from './production-settings'
export type ExtendableStage = 'mouse' | 'cluster' | 'attractor'
type ClusterChannels = Omit<ClusterInput, keyof Input>
type AttractorChannels = Omit<AttractorInput, keyof Input>
export type AdditionalForces = { cluster?: ClusterChannels; attractor?: AttractorChannels; mouse?: boolean | MouseArithmetic }
export type MouseForce = { world: Vector; strength: number }
export type ExtendedCombinedBackend = CombinedBackend & {
  setMouseRepulsion?(pointer?: MouseForce): void;
  replaceClusters?(input: ClusterChannels): void;
  replaceAttractors?(input: AttractorChannels): void;
  stepAdditionalForce?(stage: ExtendableStage, alpha: number): boolean;
}
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
@fragment fn fragmentMain() -> @location(0) vec4<f32> { return vec4(${graphRgb.link},1.); }
`
export async function createCombinedWebGPU (
  canvas: HTMLCanvasElement, graph: GraphInput, input: Input, precision: SpringPrecision = 'baseline',
  overrides: WebGPUOptions & {
    roundedStages?: readonly Stage[]; polarGravity?: boolean; refinedTrig?: boolean; gpuBounds?: boolean; springOptimization?: SpringOptimization;
    hubThreshold?: number; gridAggregation?: AggregationMode; nearArithmetic?: 'native' | 'refined' | 'factorized'; repulsionPolicy?: RepulsionPolicy;
    forceSettings?: ForceSettings; adaptiveSampling?: boolean; collisionAlternatives?: readonly CollisionArithmetic[];
    centerForceVariant?: 'refined' | 'linear';
    centerCalculation?: 'per-point' | 'once';
    farMode?: 'streamed' | 'chunked' | 'refined' | 'workgroup' | 'workgroup-local' | 'workgroup-native-far' | 'workgroup-factorized-far';
    farChunkSize?: number;
    additionalForces?: AdditionalForces;
  } = {}
): Promise<ExtendedCombinedBackend> {
  const optimization = overrides.springOptimization ?? 'baseline'
  const policy = overrides.repulsionPolicy ?? 'hierarchical'
  const settings = overrides.forceSettings ?? forceSettings('reference', input.points.length / 4)
  validateForceSettings(settings)
  const method = (): ReturnType<typeof repulsionMethod> => repulsionMethod(input.points.length / 4, policy)
  const requireGrid = (): void => { if (method() === 'exact') throw new Error('Exact repulsion does not build a grid') }
  if (optimization !== 'baseline' && precision !== 'trig') throw new Error('Spring optimization requires the strict trig candidate')
  const hubThreshold = overrides.hubThreshold ?? HUB_THRESHOLD
  const roundRest = settings.variation[0] !== settings.variation[1]
  const prefetch = optimization === 'prefetch' ? prefetchSpringSources(hubThreshold, roundRest) : undefined
  const roundedStages = overrides.roundedStages ?? []
  const polarGravity = overrides.polarGravity ?? (precision === 'aligned' || precision === 'trig')
  const refinedTrig = overrides.refinedTrig ?? precision === 'trig'
  let stage: Stage | ExtendableStage = 'gravity'; const p = { ...REPULSION }
  let nextGraph: GraphInput | undefined
  let device: Device; let frameForces: Buffer; let replaceLinks: NonNullable<CombinedBackend['replaceLinks']>
  let readCenter: CombinedBackend['readCenter']
  const additional = overrides.additionalForces
  const initialPointCount = input.points.length / 4
  const hashedSettings = settings.hashedCollision && initialPointCount > COLLISION_EXACT_LIMIT ? settings.collision : undefined
  let collisionPass = 0
  let pointer: MouseForce | undefined
  let activeAttractor = false
  let replaceClusters: ExtendedCombinedBackend['replaceClusters']
  let replaceAttractors: ExtendedCombinedBackend['replaceAttractors']
  const activeExtra = (name: ExtendableStage): boolean => (
    name === 'mouse' ? pointer !== undefined : name === 'cluster' ? additional?.cluster !== undefined : activeAttractor
  )
  const frameStages = (): readonly (Stage | ExtendableStage)[] => {
    const core = stagesFor(settings.center, settings.collision)
    if (!additional) return core
    const stages: (Stage | ExtendableStage)[] = core.filter(name => name !== 'collision')
    if (activeExtra('mouse')) stages.unshift('mouse')
    if (activeExtra('cluster')) stages.push('cluster')
    if (activeExtra('attractor')) stages.push('attractor')
    stages.push(...core.filter(name => name === 'collision'))
    return stages
  }
  const initialFrame = frameFor(input.points, 0, settings.samples, settings.precise)
  const base = await createGridWebGPU(canvas, input, p, initialFrame, overrides.farMode ?? 'streamed', gridFactory => async resources => {
    const { positions, forces, samples } = resources; let count = resources.count
    frameForces = forces
    device = resources.device
    const scope = resourceScope(overrides.context?.ledger); const own = scope.own
    try {
      const grid = own(await gridFactory(resources))
      const center = settings.center
        ? own(await createCenterWebGPU(device, count, forces, () => settings.centerReduction ?? DEFAULT_CENTER_REDUCTION,
          overrides.centerForceVariant, overrides.centerCalculation))
        : undefined
      const hashed = hashedSettings?.strength
        ? own(await createCollisionSlotsWebGPU(device, graph.sizes, forces, hashedSettings, settings.origin ?? [0, 0], overrides.context?.ledger))
        : undefined
      // Reserve the exact path as well when the resident graph can shrink through the cutoff.
      const collision = settings.collision && (!hashedSettings || hashed)
        ? own(await createCollisionWebGPU(device, hashed ? graph.sizes.subarray(0, COLLISION_EXACT_LIMIT) : graph.sizes,
          forces, settings.collision, settings.collisionArithmetic,
          overrides.collisionAlternatives, () => settings.collisionArithmetic ?? 'strict'))
        : undefined
      let collisionIteration = 0
      const prepareCollisionResize = (sizes: Float32Array, nextCount: number): (() => void) | undefined => {
        if (hashed && nextCount > COLLISION_EXACT_LIMIT) {
          if (sizes.length !== nextCount) throw new Error('Collision slot positions and sizes disagree')
          return hashed.prepareResize(sizes)
        }
        if (!collision) return undefined
        validateSizes(sizes, nextCount)
        return (): void => collision.resize(sizes)
      }
      const cluster = additional?.cluster
        ? own(await createClusterWebGPU(device, { ...input, ...additional.cluster }, forces, overrides.context?.ledger))
        : undefined
      const attractor = additional?.attractor
        ? own(await createAttractorWebGPU(device, count, forces, overrides.context?.ledger))
        : undefined
      const mouse = additional?.mouse
        ? own(await createMouseWebGPU(device, forces, overrides.context?.ledger, additional.mouse === true ? undefined : additional.mouse))
        : undefined
      if (cluster) replaceClusters = (next): void => { cluster.update({ ...input, ...next }) }
      if (attractor && additional?.attractor) {
        replaceAttractors = (next): void => {
          const packed = packAttractors({ ...input, ...next })
          attractor.update(packed.values)
          activeAttractor = packed.active
        }
        replaceAttractors(additional.attractor)
      }
      readCenter = center?.read
      const exactParams = policy === 'production' ? own(upload(device, new Float32Array(8), Buffer.UNIFORM)) : undefined
      const exact = exactParams
        ? own(await Kernel.createAsync(device, {
          source: strictExactShader(),
          entryPoint: 'direct',
          shaderLayout: {
            bindings: bindingLayout([
              ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
            ]),
          },
        }))
        : undefined
      const gravityParams = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      const gravityOrigin = settings.origin ? own(upload(device, new Float32Array([...settings.origin, 0, 0]), Buffer.UNIFORM)) : undefined
      const springParams = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
      const threshold = prefetch ? hubThreshold : undefined
      let linkResources = createLinkResources(device, input.points, graph, overrides.context?.ledger, threshold); let version = 0
      own({ destroy: () => linkResources.destroy() })
      replaceLinks = (next): ReturnType<NonNullable<CombinedBackend['replaceLinks']>> => {
        const resizeCollision = prepareCollisionResize(next.sizes, count)
        const replacement = createLinkResources(device, input.points, next, overrides.context?.ledger, threshold)
        try { resizeCollision?.() } catch (error) { replacement.destroy(); throw error }
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
      if (gravityOrigin) gravityBindings.push({ name: 'gravityOrigin', type: 'uniform', location: 3, group: 0 })
      let selectedGravity = polarGravity ? refinedTrig ? refinedGravitySource : polarGravitySource : gravitySource
      if (gravityOrigin) {
        selectedGravity = polarGravity
          ? replaceOnce(selectedGravity, 'let delta = -positions[id.x].xy;',
            'let point = positions[id.x]; let delta = vec2f(springSub(gravityOrigin.x, point.x), springSub(gravityOrigin.y, point.y));')
          : replaceOnce(selectedGravity, '-positions[id.x].xy', '(gravityOrigin.xy - positions[id.x].xy)')
        selectedGravity += '\n@group(0) @binding(3) var<uniform> gravityOrigin: vec4f;\n'
      }
      const gravity = own(polarGravity
        ? await createRoundedKernel(device, selectedGravity, gravityBindings)
        : await Kernel.createAsync(device, { source: selectedGravity, shaderLayout: { bindings: gravityBindings } }))
      const springBindings = bindingLayout([
        ['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['edges', 'read-only-storage'],
        ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
      ])
      const roundedProducts = precision === 'products' || precision === 'composed' || precision === 'aligned' || precision === 'trig'
      const roundSpring = ['integration', 'both', 'refined', 'distance', 'products', 'composed', 'aligned', 'trig'].includes(precision)
      const extraStages = precision === 'trig'
        ? [...roundedStages, 'gravity', 'center', 'repulsion']
        : precision === 'composed' || precision === 'aligned' ? [...roundedStages, 'repulsion'] : roundedStages
      const spring = own(precision === 'force' || precision === 'both' || precision === 'refined'
        ? await createRoundedKernel(device, roundedSpringSource(precision === 'refined'), springBindings)
        : await Kernel.createAsync(device, {
          source: prefetch?.regular ?? (optimization === 'hoist'
            ? hoistedSpringSource(roundRest)
            : roundedProducts ? distanceSpringSource('products', roundRest) : precision === 'distance' ? distanceSpringSource() : springSource),
          shaderLayout: { bindings: springBindings },
        }))
      const hub = prefetch
        ? own(await Kernel.createAsync(device, {
          source: prefetch.hub,
          shaderLayout: { bindings: [...springBindings, { name: 'hubs', location: 6, type: 'read-only-storage', group: 0 }] },
        }))
        : undefined
      // Directions without hubs use the unchanged baseline source, avoiding a
      // degree guard and hoist on every low-degree point. No extra dispatch.
      const fallback = prefetch
        ? own(await Kernel.createAsync(device, { source: distanceSpringSource('products', roundRest), shaderLayout: { bindings: springBindings } }))
        : spring
      const integrationParams = own(upload(device, new Float32Array([count, 0, 0, 0, p.friction, p.referenceLength, 0, 0]), Buffer.UNIFORM))
      const collisionIntegrationParams = collision || hashed
        ? own(upload(device, new Float32Array([count, 0, 0, 0, 1, p.referenceLength, 0, 0]), Buffer.UNIFORM))
        : undefined
      const integration = roundSpring || extraStages.length > 0 || collision || hashed || cluster || attractor || mouse
        ? own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ])))
        : undefined
      return {
        resize (next): void {
          if (!nextGraph) throw new Error('Use resizeGraph to update composed resources')
          const resizeCollision = prepareCollisionResize(nextGraph.sizes, next.points.length / 4)
          linkResources.update(next.points, nextGraph)
          grid.resize!(next)
          center?.resize(next.points.length / 4)
          resizeCollision?.()
          count = next.points.length / 4; input = next
          integrationParams.write(new Float32Array([count, 0, 0, 0, p.friction, p.referenceLength, 0, 0]))
          collisionIntegrationParams?.write(new Float32Array([count, 0, 0, 0, 1, p.referenceLength, 0, 0]))
        },
        integrate (source, timing, sharedPass): boolean {
          const rounded = stage === 'collision' || stage === 'mouse' || stage === 'cluster' || stage === 'attractor' ||
            (roundSpring && (stage === 'incoming' || stage === 'outgoing')) || extraStages.includes(stage)
          if (!integration || !rounded) return false
          const pass = sharedPass ?? device.beginComputePass(timing)
          try {
            integration.dispatch(pass, {
              x: Math.ceil(count / 64),
              bindings: {
                positions: positions[source],
                forces,
                params: stage === 'collision' ? collisionIntegrationParams! : integrationParams,
                output: positions[1 - source],
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
          if (!hashed || count <= COLLISION_EXACT_LIMIT) collision?.render(positions[source], view, pass)
        },
        prepare (): void {
          if (stage === 'center') return
          if (stage === 'collision') {
            if (hashed && hashedSettings && count > COLLISION_EXACT_LIMIT) {
              collisionIteration = collisionPass % hashedSettings.iterations
              hashed.prepare(collisionPassFrame(collisionPass++, p.alpha), collisionIteration)
            }
            return
          }
          if (stage === 'mouse') { mouse!.prepare(count, pointer!.world, pointer!.strength); return }
          if (stage === 'cluster') { cluster!.prepare(p.alpha, CLUSTER.strength); return }
          if (stage === 'attractor') { attractor!.prepare(p.alpha, ATTRACTOR.strength); return }
          if (stage === 'repulsion') {
            if (method() === 'exact') {
              exactParams!.write(new Float32Array([
                count, p.alpha, p.repulsion, nearLimit(count, p), p.friction, p.referenceLength, 0, 0,
              ]))
            } else grid.prepare?.()
          } else if (stage === 'gravity') gravityParams.write(new Float32Array([count, p.alpha, GRAVITY, 0]))
          else {
            springParams.write(new Float32Array([SPRINGS.spring, SPRINGS.distance, ...settings.variation, p.alpha,
              SPRINGS.friction, SPRINGS.maxStep, settings.collision?.strength ? 1 : 0,
              settings.collision?.radius ?? 0, settings.collision?.padding ?? 0, count, 0]))
          }
        },
        encode (source, timing, sharedPass, profile): void {
          if (stage === 'collision') {
            if (!collision) throw new Error('Collision was not allocated')
            if (profile) throw new Error('Collision-enabled frames require normal-frame timing')
            const pass = sharedPass ?? device.beginComputePass(timing)
            try {
              if (hashed && count > COLLISION_EXACT_LIMIT) hashed.encode(pass, positions[source], collisionIteration)
              else collision.encode(pass, positions[source], p.alpha)
            } finally { if (!sharedPass) pass.end() }
            return
          }
          if (stage === 'center') {
            if (!center) throw new Error('Center force was not allocated')
            const encodeCenter = (pass: ComputePass): void => center.encode(pass, positions[source], p.alpha, settings.center ?? 0)
            if (profile) { profile('force', encodeCenter); return }
            const pass = sharedPass ?? device.beginComputePass(timing)
            try { encodeCenter(pass) } finally { if (!sharedPass) pass.end() }
            return
          }
          if (stage === 'repulsion' && method() === 'hierarchical') { grid.encode(source, timing, sharedPass, profile); return }
          const encode = (pass: ComputePass): void => {
            if (stage === 'mouse') mouse!.encode(pass, positions[source])
            else if (stage === 'cluster') cluster!.encode(pass, positions[source])
            else if (stage === 'attractor') attractor!.encode(pass, positions[source])
            else if (stage === 'repulsion') {
              exact!.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[source], samples, params: exactParams!, forces } })
            } else if (stage === 'gravity') {
              gravity.dispatch(pass, {
                x: Math.ceil(count / 64),
                bindings: { positions: positions[source], params: gravityParams, forces, ...(gravityOrigin ? { gravityOrigin } : {}) },
              })
            } else {
              const side = stage === 'incoming' ? 0 : 1
              const kernel = hub && !linkResources.hubCounts[side] ? fallback : spring
              kernel.dispatch(pass, {
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
              if (hub && linkResources.hubCounts[side]) {
                hub.dispatch(pass, {
                  x: linkResources.hubCounts[side],
                  bindings: {
                    positions: positions[source],
                    offsets: linkResources.offsets[side],
                    edges: linkResources.edges[side],
                    sizes: linkResources.sizes,
                    params: springParams,
                    forces,
                    hubs: linkResources.hubs![side],
                  },
                })
              }
            }
          }
          if (profile) { profile('force', encode); return }
          const pass = sharedPass ?? device.beginComputePass(timing)
          try { encode(pass) } finally { if (!sharedPass) pass.end() }
        },
        destroy: scope.destroy,
      }
    } catch (error) { scope.destroy(); throw error }
  }, {
    gpuBounds: overrides.gpuBounds,
    context: overrides.context,
    preserve: overrides.preserve,
    aggregation: overrides.gridAggregation,
    nearArithmetic: overrides.nearArithmetic ?? (precision === 'trig' ? 'refined' : 'native'),
    maxSamples: overrides.adaptiveSampling ? 64 : settings.samples,
    occupancy: overrides.adaptiveSampling,
    farChunkSize: overrides.farChunkSize,
  })
  function beginFrame (tick: number): void {
    base.setGpuFrame!(tick)
    if (hashedSettings) collisionPass = tick * hashedSettings.iterations
  }
  return {
    ...base,
    setGpuFrame: base.setGpuFrame ? beginFrame : undefined,
    readCenter,
    name: `WebGPU composed (${policy} repulsion)`,
    repulsionMethod: method,
    requestOccupancy: base.requestOccupancy ? (): void => { requireGrid(); base.requestOccupancy!() } : undefined,
    readOccupancy: base.readOccupancy
      ? async (): ReturnType<NonNullable<CombinedBackend['readOccupancy']>> => {
        requireGrid(); return base.readOccupancy!()
      }
      : undefined,
    readStructure: async (): ReturnType<CombinedBackend['readStructure']> => {
      requireGrid()
      return base.readStructure()
    },
    readCentroids: async (): ReturnType<NonNullable<CombinedBackend['readCentroids']>> => { requireGrid(); return base.readCentroids!() },
    readBounds: async (): ReturnType<NonNullable<CombinedBackend['readBounds']>> => { requireGrid(); return base.readBounds!() },
    diagnose: async (): ReturnType<NonNullable<CombinedBackend['diagnose']>> => {
      requireGrid()
      return base.diagnose!()
    },
    resizeGraph (graph, nextInput, preserve): ReturnType<NonNullable<CombinedBackend['resizeGraph']>> {
      if ((additional?.cluster || additional?.attractor) && nextInput.points.length !== initialPointCount * 4) {
        throw new Error('Recreate the composed resources when replacing attraction data of a different size')
      }
      nextGraph = graph
      try { return base.resizeInput!(nextInput, preserve) } finally { nextGraph = undefined }
    },
    replaceLinks: (next): ReturnType<NonNullable<CombinedBackend['replaceLinks']>> => { base.resourceIdentity!(); return replaceLinks(next) },
    setMouseRepulsion: additional?.mouse
      ? (next): void => {
        base.resourceIdentity!()
        if (!next) { pointer = undefined; return }
        const [x, y, strength] = pointerUniform(next.world, next.strength)
        pointer = { world: [x, y], strength }
      }
      : undefined,
    replaceClusters: replaceClusters
      ? (next): void => { base.resourceIdentity!(); replaceClusters!(next) }
      : undefined,
    replaceAttractors: replaceAttractors
      ? (next): void => { base.resourceIdentity!(); replaceAttractors!(next) }
      : undefined,
    stepAdditionalForce: additional
      ? (next, alpha): boolean => {
        if (!activeExtra(next)) return false
        stage = next; p.alpha = alpha; base.step()
        return true
      }
      : undefined,
    measureFrozenFrames: overrides.gpuBounds
      ? async ({ frames, alpha, tick, view, stages: selected }): ReturnType<NonNullable<CombinedBackend['measureFrozenFrames']>> => {
        validateBatch(frames); base.resourceIdentity!()
        const bytes = base.positionSource!().count * 16; const scope = resourceScope(overrides.context?.ledger)
        const allocate = (byteLength: number): Buffer => scope.own(device.createBuffer({
          byteLength, usage: Buffer.COPY_SRC | Buffer.COPY_DST,
        }))
        try {
          const frozen = allocate(bytes); const outputs = allocate(bytes * frames); const forces = allocate(bytes * frames)
          device.commandEncoder.copyBufferToBuffer({ sourceBuffer: base.positionSource!().buffer, destinationBuffer: frozen, size: bytes })
          device.submit()
          const timing = await measureFrameBatch(device, frames, 2, (query, frame) => {
            // Copies are outside pass timestamp endpoints. Capture EVERY frame
            // for validation after the batch; no CPU wait separates its frames.
            device.commandEncoder.copyBufferToBuffer({ sourceBuffer: frozen, destinationBuffer: base.positionSource!().buffer, size: bytes })
            beginFrame(tick)
            const pass = device.beginComputePass(query
              ? { timestampQuerySet: query, beginTimestampIndex: frame * 4, endTimestampIndex: frame * 4 + 1 }
              : {})
            try {
              for (const next of selected ?? frameStages()) {
                stage = next; p.alpha = alpha; base.step({ submit: false, pass })
              }
            } finally { pass.end() }
            base.render(view, query
              ? { timestampQuerySet: query, beginTimestampIndex: frame * 4 + 2, endTimestampIndex: frame * 4 + 3 }
              : {}, false)
            device.commandEncoder.copyBufferToBuffer({
              sourceBuffer: base.positionSource!().buffer, destinationBuffer: outputs, destinationOffset: frame * bytes, size: bytes,
            })
            device.commandEncoder.copyBufferToBuffer({
              sourceBuffer: frameForces, destinationBuffer: forces, destinationOffset: frame * bytes, size: bytes,
            })
          })
          const [allPositions, allForces] = await Promise.all([readFloats(outputs), readFloats(forces)])
          const floats = bytes / 4
          return {
            timing,
            frameGpuMs: timing.frameGpuMs,
            snapshots: Array.from({ length: frames }, (_, i) => ({
              positions: allPositions.slice(i * floats, (i + 1) * floats), forces: allForces.slice(i * floats, (i + 1) * floats),
            })),
          }
        } finally { scope.destroy() }
      }
      : undefined,
    profileCurrentFrame: overrides.gpuBounds
      ? async (alpha, tick, view): ReturnType<NonNullable<CombinedBackend['profileCurrentFrame']>> => {
        if (settings.center || settings.collision?.strength || additional) {
          throw new Error('Optional forces require normal-frame timing; the historical profile has fifteen fixed stages')
        }
        if (method() === 'exact') throw new Error('The fifteen-stage grid profile requires hierarchical repulsion; use normal-frame timing for exact repulsion')
        base.resourceIdentity!(); beginFrame(tick)
        const result = await measureGpuStages(device, (scope, draw) => {
          for (const next of stagesFor(settings.center, settings.collision)) {
            stage = next; p.alpha = alpha
            base.step({ submit: false, profile: (name, work) => scope(`${next}.${name}`, work) })
          }
          base.render(view, draw(), false)
        }).catch(error => { base.resourceIdentity!(); throw error })
        return { ...result, snapshot: await base.read() }
      }
      : undefined,
    measureCurrentFrame: overrides.gpuBounds
      ? async (alpha, tick, view, selected): ReturnType<NonNullable<CombinedBackend['measureCurrentFrame']>> => {
        base.resourceIdentity!()
        const timing = await measureFrameBatch(device, 1, 2, (query) => {
          beginFrame(tick)
          const pass = device.beginComputePass(query ? { timestampQuerySet: query, beginTimestampIndex: 0, endTimestampIndex: 1 } : {})
          try {
            for (const next of selected ?? frameStages()) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
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
          beginFrame(tick)
          const index = frame * (draw ? 4 : 2)
          const pass = device.beginComputePass(query ? { timestampQuerySet: query, beginTimestampIndex: index, endTimestampIndex: index + 1 } : {})
          try {
            for (const next of frameStages()) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
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
    // Diagnostic pass boundaries only; the normal tick still uses one compute pass.
    stepProfiledTick: overrides.gpuBounds
      ? (alpha, tick, scope): void => {
        base.resourceIdentity!()
        if (settings.collision?.strength || additional) throw new Error('Optional forces require normal-frame timing')
        beginFrame(tick)
        for (const next of stagesFor(settings.center, settings.collision)) {
          stage = next; p.alpha = alpha
          base.step({ submit: false, profile: (name, work) => scope(`${next}.${name}`, work) })
        }
        device.submit()
      }
      : undefined,
    stepTick: overrides.gpuBounds
      ? (alpha, tick, timestamps): void => {
        beginFrame(tick)
        const pass = device.beginComputePass(timestamps)
        try {
          for (const next of frameStages()) { stage = next; p.alpha = alpha; base.step({ submit: false, pass }) }
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
