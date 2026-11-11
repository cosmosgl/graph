import { Buffer, type ComputePass } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { createWebGPU, type WebGPUForceFactory, type WebGPUOptions } from '../many-body/webgpu'
import { resourceScope } from '../../gpu/resource-scope'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { nearLimit, type Input, type Parameters } from '../many-body/data'
import { contributionShader } from './contributions'
import { verifyCountDivision } from './division-check'
import { streamedFarShader, refinedFarShader, materializedFarShader } from './far-shader'
import { storedCentroidShader, type CentroidMode } from './centroids'
import { gpuTraceShader, replaceOnce, stageNames } from './trace'
import { frameSamples, layout, type Frame, type Structure } from './data'
import { createGpuBounds } from './bounds'
import { cachedCellShader, aggregationLimit, type AggregationMode } from './aggregation'
import type { GridBackend } from './backend'
import shader from './grid.wgsl?raw'
const profileGroups: Record<string, string> = {
  clear: 'bin',
  linkPoints: 'bin',
  aggregate: 'aggregate',
  selectSlots: 'samples',
  centroidMain: 'centroids',
  farMain: 'far',
  accumulateMain: 'far',
  forceMain: 'resolve',
}
export async function createGridWebGPU (
  canvas: HTMLCanvasElement, input: Input, p: Parameters, initial: Frame, centroidMode: CentroidMode = 'inline',
  wrapForce: (factory: WebGPUForceFactory) => WebGPUForceFactory = (factory): WebGPUForceFactory => factory,
  options: WebGPUOptions & { gpuBounds?: boolean; aggregation?: AggregationMode } = {}
): Promise<GridBackend> {
  let sourceShader = centroidMode !== 'inline' ? storedCentroidShader(shader, centroidMode !== 'stored') : shader
  const streamed = centroidMode === 'streamed'
  if (streamed) sourceShader = streamedFarShader(sourceShader)
  if (centroidMode === 'refined') sourceShader = refinedFarShader(sourceShader)
  if (centroidMode === 'materialized') sourceShader = materializedFarShader(sourceShader)
  if (options.gpuBounds) sourceShader = replaceOnce(sourceShader, 'var<uniform> box:', 'var<storage, read> box:')
  const cachedCells = options.aggregation === 'cached-cells' || options.aggregation === 'cached-small'
  if (cachedCells) sourceShader = cachedCellShader(sourceShader, aggregationLimit(options.aggregation!))
  let readContributions: GridBackend['readContributions']
  let verifyDivision: GridBackend['verifyDivision']
  let readCentroids: (() => Promise<Float32Array>) | undefined
  let frame = initial
  let gpuTick: number | undefined
  let readBounds: GridBackend['readBounds']
  let diagnose: NonNullable<GridBackend['diagnose']>
  let readStructure: () => Promise<Structure> = async () => { throw new Error('Grid not initialized') }
  const base = await createWebGPU(canvas, input, p, 'direct', wrapForce(async ({ device, positions, samples, forces, count: initialCount, capacity }) => {
    const scope = resourceScope(options.context?.ledger); const own = scope.own
    try {
      let count = initialCount; let l = layout(count)
      const allocated = layout(capacity)
      if (centroidMode !== 'inline' && centroidMode !== 'stored') verifyDivision = (): ReturnType<typeof verifyCountDivision> => verifyCountDivision(device)
      const storage = (bytes: number): Buffer => own(device.createBuffer({ byteLength: Math.max(16, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const farContributions = centroidMode === 'materialized' || streamed ? storage(capacity * (streamed ? 1 : allocated.sizes.length) * 100 * 8) : undefined
      const farSums = streamed ? storage(capacity * allocated.sizes.length * 8) : undefined
      const levelQueries = streamed ? allocated.sizes.map((_, level) => own(upload(device, new Uint32Array([level, 0, 0, 0]), Buffer.UNIFORM))) : []
      const heads = storage(allocated.cells * 4); const links = storage(allocated.sizes.length * capacity * 4)
      const pointCells = cachedCells ? storage(allocated.sizes.length * capacity * 4) : undefined
      const aggregates = storage(allocated.cells * 16); const slots = storage(allocated.finest ** 2 * frame.slots * 8)
      const centroids = centroidMode !== 'inline' ? storage(allocated.cells * 16) : undefined
      if (centroids) readCentroids = (): Promise<Float32Array> => readFloats(centroids, l.cells * 16)
      const levels = own(upload(device, new Uint32Array(allocated.sizes.flatMap((n, i) => [n, allocated.offsets[i], 0, 0]))))
      const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
      const box = own(upload(device, frame.bounds, options.gpuBounds ? Buffer.STORAGE : Buffer.UNIFORM))
      const bounds = options.gpuBounds ? own(await createGpuBounds(device, count, l.finest, box, options.context?.ledger, capacity)) : undefined
      readBounds = (): Promise<Float32Array> => readFloats(box)
      const bindings = bindingLayout([
        ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['heads', 'storage'], ['links', 'storage'],
        ['aggregates', 'storage'], ['slots', 'storage'], ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'],
        ['box', options.gpuBounds ? 'read-only-storage' : 'uniform'],
      ])
      if (centroids) bindings.push({ name: 'centroids', location: 11, type: 'storage', group: 0 })
      if (farContributions) bindings.push({ name: 'farContributions', location: 12, type: 'storage', group: 0 })
      if (streamed) {
        bindings.push(
          { name: 'farLevel', location: 13, type: 'uniform', group: 0 },
          { name: 'farSums', location: 14, type: 'storage', group: 0 })
      }
      if (pointCells) bindings.push({ name: 'pointCells', location: 15, type: 'storage', group: 0 })
      const forceNames = [
        'positions', 'samples', 'aggregates', 'slots', 'forces', 'levels', 'params', 'box',
        ...(centroids ? ['centroids'] : []), ...(farContributions && !streamed ? ['farContributions'] : []), ...(streamed ? ['farSums'] : []),
      ].filter(name => !farContributions || name !== 'aggregates')
      const used = [
        ['heads', 'params'],
        ['positions', 'heads', 'links', 'levels', 'params', 'box', ...(pointCells ? ['pointCells'] : [])],
        ['positions', 'heads', 'links', 'aggregates', 'levels', 'params', ...(pointCells ? ['pointCells'] : ['box'])],
        ['heads', 'links', 'slots', 'levels', 'params'],
        ...(centroids ? [['aggregates', 'params', 'centroids']] : []),
        ...(farContributions
          ? [['positions', 'aggregates', 'levels', 'params', 'box', 'centroids', 'farContributions',
            ...(streamed ? ['farLevel'] : [])]]
          : []),
        ...(streamed ? [['positions', 'levels', 'params', 'box', 'centroids', 'farContributions', 'farLevel', 'farSums']] : []),
        forceNames,
      ]
      const kernels: Kernel[] = []
      const entryPoints = ['clear', 'linkPoints', 'aggregate', 'selectSlots',
        ...(centroids ? ['centroidMain'] : []), ...(farContributions ? ['farMain'] : []), ...(streamed ? ['accumulateMain'] : []), 'forceMain']
      for (const entryPoint of entryPoints) {
        kernels.push(own(await Kernel.createAsync(device, {
          id: `grid-${entryPoint}`,
          source: sourceShader,
          entryPoint,
          shaderLayout: { bindings: bindings.filter(b => used[kernels.length].includes(b.name)) },
        })))
      }
      let lastSource = -1
      diagnose = async (): ReturnType<NonNullable<GridBackend['diagnose']>> => {
        if (lastSource < 0) throw new Error('Step before diagnosing')
        // Temporary resources keep tracing out of normal execution and release on failure.
        const temporary: Array<{ destroy(): void }> = []
        const keep = <T extends { destroy(): void }>(r: T): T => { temporary.push(r); return r }
        try {
          const names = stageNames(count)
          const trace = keep(device.createBuffer({ byteLength: count * 16 * names.length, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
          const output = keep(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
          const kernel = keep(await Kernel.createAsync(device, {
            id: 'grid-force-trace',
            source: gpuTraceShader(sourceShader),
            entryPoint: 'forceMain',
            shaderLayout: { bindings: [...bindings.filter(b => forceNames.includes(b.name)), { name: 'trace', location: 10, type: 'storage', group: 0 }] },
          }))
          const pass = device.beginComputePass()
          try {
            kernel.dispatch(pass, {
              x: Math.ceil(count / 64),
              bindings: {
                positions: positions[lastSource],
                samples,
                ...(!farContributions ? { aggregates } : {}),
                slots,
                forces: output,
                levels,
                params,
                box,
                trace,
                ...(centroids ? { centroids } : {}),
                ...(farContributions && !streamed ? { farContributions } : {}),
                ...(farSums ? { farSums } : {}),
              },
            })
          } finally { pass.end() }
          device.submit()
          const data = await readFloats(trace)
          return {
            trace: Object.fromEntries(names.map((name, i) => [name, data.slice(i * count * 4, (i + 1) * count * 4)])),
            forces: await readFloats(output),
          }
        } finally { temporary.reverse().forEach(r => r.destroy()) }
      }
      if (centroids && !farContributions) {
        readContributions = async (target): ReturnType<NonNullable<GridBackend['readContributions']>> => {
          if (lastSource < 0 || target < 0 || target >= count || !Number.isInteger(target)) throw new Error('Invalid contribution target or unstepped backend')
          const temporary: Array<{ destroy(): void }> = []
          const keep = <T extends { destroy(): void }>(r: T): T => { temporary.push(r); return r }
          try {
            const contributions = keep(device.createBuffer({ byteLength: l.sizes.length * 100 * 64, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
            const output = keep(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
            const query = keep(upload(device, new Float32Array([count, l.finest, l.sizes.length, frame.slots, p.alpha, p.repulsion, nearLimit(count, p),
              frame.precise ? 1 : 0, frame.seed, l.cells, target, 0]), Buffer.UNIFORM))
            const kernel = keep(await Kernel.createAsync(device, {
              id: 'grid-cell-contributions',
              source: contributionShader(sourceShader),
              entryPoint: 'forceMain',
              shaderLayout: {
                bindings: [...bindings.filter(b => forceNames.includes(b.name)),
                  { name: 'contributions', location: 10, type: 'storage', group: 0 }],
              },
            }))
            const pass = device.beginComputePass()
            try {
              kernel.dispatch(pass, {
                x: 1,
                bindings: {
                  positions: positions[lastSource],
                  samples,
                  aggregates,
                  slots,
                  forces: output,
                  levels,
                  params: query,
                  box,
                  centroids,
                  contributions,
                },
              })
            } finally { pass.end() }
            device.submit()
            return { data: await readFloats(contributions), forces: await readFloats(output) }
          } finally { temporary.reverse().forEach(r => r.destroy()) }
        }
      }
      readStructure = async (): Promise<Structure> => ({
        aggregates: await readFloats(aggregates, l.cells * 16), slots: await readFloats(slots, l.finest ** 2 * frame.slots * 8),
      })
      return {
        resize (next): void {
          const n = next.points.length / 4
          if (n > capacity) throw new Error('Grid capacity exceeded')
          count = n; l = layout(count); lastSource = -1
          levels.write(new Uint32Array(l.sizes.flatMap((size, i) => [size, l.offsets[i], 0, 0])))
          bounds?.resize(count, l.finest)
        },
        prepare (): void {
          params.write(new Float32Array([count, l.finest, l.sizes.length, frame.slots, p.alpha, p.repulsion, nearLimit(count, p),
            frame.precise ? 1 : 0, frame.seed, l.cells, 0, 0]))
          if (gpuTick === undefined) box.write(frame.bounds)
          else bounds!.prepare(gpuTick)
        },
        encode (source, timing, sharedPass, profile): void {
          lastSource = source
          const sizes = [l.cells, count, l.cells, l.finest ** 2,
            ...(centroids ? [l.cells] : []), ...(farContributions ? [count] : []), ...(streamed ? [count] : []), count]
          const dispatches = kernels.flatMap<{ i: number; farLevel?: Buffer }>((_, i) => {
            if (streamed && entryPoints[i] === 'accumulateMain') return []
            if (streamed && entryPoints[i] === 'farMain') {
              return levelQueries.slice(0, l.sizes.length).flatMap(farLevel => [{ i, farLevel }, { i: i + 1, farLevel }])
            }
            return [{ i, farLevel: undefined }]
          }).filter(d => sizes[d.i] > 0)
          const dispatch = (pass: ComputePass, { i, farLevel }: typeof dispatches[number]): void => {
            kernels[i].dispatch(pass, {
              x: Math.ceil(sizes[i] / 64),
              bindings: Object.fromEntries(Object.entries({
                positions: positions[source],
                samples,
                heads,
                links,
                aggregates,
                slots,
                forces,
                levels,
                params,
                box,
                ...(pointCells ? { pointCells } : {}),
                ...(centroids ? { centroids } : {}),
                ...(farContributions ? { farContributions } : {}),
                ...(streamed ? { farLevel, farSums } : {}),
              }).filter(([name]) => used[i].includes(name))),
            })
          }
          if (profile) {
            if (gpuTick !== undefined) profile('bounds', pass => bounds!.encode(pass, positions[source]))
            const groups: Array<{ name: string; dispatches: typeof dispatches }> = []
            for (const d of dispatches) {
              const name = profileGroups[entryPoints[d.i]]
              if (groups.at(-1)?.name !== name) groups.push({ name, dispatches: [] })
              groups.at(-1)!.dispatches.push(d)
            }
            for (const group of groups) profile(group.name, pass => { for (const d of group.dispatches) dispatch(pass, d) })
            return
          }
          const pass = sharedPass ?? device.beginComputePass(timing)
          try {
            if (gpuTick !== undefined) bounds!.encode(pass, positions[source])
            for (const d of dispatches) dispatch(pass, d)
          } finally { if (!sharedPass) pass.end() }
        },
        destroy: scope.destroy,
      }
    } catch (error) { scope.destroy(); throw error }
  }), options)
  return {
    ...base,
    name: `WebGPU grid (${centroidMode} centroids)`,
    readCentroids,
    readBounds: () => readBounds!(),
    setGpuFrame: options.gpuBounds
      ? (tick): void => {
        if (!Number.isInteger(tick) || tick < 0) throw new Error('Invalid GPU frame tick')
        gpuTick = tick; frame = { ...frame, seed: frameSamples(tick).seed }
      }
      : undefined,
    verifyDivision,
    readContributions,
    diagnose: () => diagnose(),
    readStructure: () => readStructure(),
    setFrame (next): void {
      if (next.slots !== initial.slots) throw new Error('Recreate the backend to change slot count')
      frame = next
      gpuTick = undefined
    },
  }
}
