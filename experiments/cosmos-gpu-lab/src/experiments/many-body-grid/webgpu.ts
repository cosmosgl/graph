import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { createWebGPU } from '../many-body/webgpu'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { nearLimit, type Input, type Parameters } from '../many-body/data'
import { contributionShader } from './contributions'
import { verifyCountDivision } from './division-check'
import { streamedFarShader, refinedFarShader, materializedFarShader } from './far-shader'
import { storedCentroidShader, type CentroidMode } from './centroids'
import { gpuTraceShader, stageNames } from './trace'
import { layout, type Frame, type Structure } from './data'
import type { GridBackend } from './backend'
import shader from './grid.wgsl?raw'
export async function createGridWebGPU (
  canvas: HTMLCanvasElement, input: Input, p: Parameters, initial: Frame, centroidMode: CentroidMode = 'inline'
): Promise<GridBackend> {
  let sourceShader = centroidMode !== 'inline' ? storedCentroidShader(shader, centroidMode !== 'stored') : shader
  const streamed = centroidMode === 'streamed'
  if (streamed) sourceShader = streamedFarShader(sourceShader)
  if (centroidMode === 'refined') sourceShader = refinedFarShader(sourceShader)
  if (centroidMode === 'materialized') sourceShader = materializedFarShader(sourceShader)
  let readContributions: GridBackend['readContributions']
  let verifyDivision: GridBackend['verifyDivision']
  let readCentroids: (() => Promise<Float32Array>) | undefined
  let frame = initial
  let diagnose: NonNullable<GridBackend['diagnose']>
  let readStructure: () => Promise<Structure> = async () => { throw new Error('Grid not initialized') }
  const base = await createWebGPU(canvas, input, p, 'direct', async ({ device, positions, samples, forces, count }) => {
    const owned: Array<{ destroy(): void }> = []
    const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const l = layout(count)
      if (centroidMode !== 'inline' && centroidMode !== 'stored') verifyDivision = (): ReturnType<typeof verifyCountDivision> => verifyCountDivision(device)
      const storage = (bytes: number): Buffer => own(device.createBuffer({ byteLength: Math.max(16, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const farContributions = centroidMode === 'materialized' || streamed ? storage(count * (streamed ? 1 : l.sizes.length) * 100 * 8) : undefined
      const farSums = streamed ? storage(count * l.sizes.length * 8) : undefined
      const levelQueries = streamed ? l.sizes.map((_, level) => own(upload(device, new Uint32Array([level, 0, 0, 0]), Buffer.UNIFORM))) : []
      const heads = storage(l.cells * 4); const links = storage(l.sizes.length * count * 4)
      const aggregates = storage(l.cells * 16); const slots = storage(l.finest ** 2 * frame.slots * 8)
      const centroids = centroidMode !== 'inline' ? storage(l.cells * 16) : undefined
      if (centroids) readCentroids = (): Promise<Float32Array> => readFloats(centroids)
      const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
      const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM)); const box = own(upload(device, frame.bounds, Buffer.UNIFORM))
      const bindings = bindingLayout([
        ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['heads', 'storage'], ['links', 'storage'],
        ['aggregates', 'storage'], ['slots', 'storage'], ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'], ['box', 'uniform'],
      ])
      if (centroids) bindings.push({ name: 'centroids', location: 11, type: 'storage', group: 0 })
      if (farContributions) bindings.push({ name: 'farContributions', location: 12, type: 'storage', group: 0 })
      if (streamed) {
        bindings.push(
          { name: 'farLevel', location: 13, type: 'uniform', group: 0 },
          { name: 'farSums', location: 14, type: 'storage', group: 0 })
      }
      const forceNames = [
        'positions', 'samples', 'aggregates', 'slots', 'forces', 'levels', 'params', 'box',
        ...(centroids ? ['centroids'] : []), ...(farContributions && !streamed ? ['farContributions'] : []), ...(streamed ? ['farSums'] : []),
      ].filter(name => !farContributions || name !== 'aggregates')
      const used = [
        ['heads', 'params'],
        ['positions', 'heads', 'links', 'levels', 'params', 'box'],
        ['positions', 'heads', 'links', 'aggregates', 'levels', 'params', 'box'],
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
      readStructure = async (): Promise<Structure> => ({ aggregates: await readFloats(aggregates), slots: await readFloats(slots) })
      return {
        prepare (): void {
          params.write(new Float32Array([count, l.finest, l.sizes.length, frame.slots, p.alpha, p.repulsion, nearLimit(count, p),
            frame.precise ? 1 : 0, frame.seed, l.cells, 0, 0]))
          box.write(frame.bounds)
        },
        encode (source, timing): void {
          lastSource = source
          const sizes = [l.cells, count, l.cells, l.finest ** 2,
            ...(centroids ? [l.cells] : []), ...(farContributions ? [count] : []), ...(streamed ? [count] : []), count]
          const dispatches = kernels.flatMap<{ i: number; farLevel?: Buffer }>((_, i) => {
            if (streamed && entryPoints[i] === 'accumulateMain') return []
            if (streamed && entryPoints[i] === 'farMain') return levelQueries.flatMap(farLevel => [{ i, farLevel }, { i: i + 1, farLevel }])
            return [{ i, farLevel: undefined }]
          }).filter(d => sizes[d.i] > 0)
          const pass = device.beginComputePass(timing)
          try {
            for (const { i, farLevel } of dispatches) {
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
                  ...(centroids ? { centroids } : {}),
                  ...(farContributions ? { farContributions } : {}),
                  ...(streamed ? { farLevel, farSums } : {}),
                }).filter(([name]) => used[i].includes(name))),
              })
            }
          } finally { pass.end() }
        },
        destroy (): void { owned.reverse().forEach(resource => resource.destroy()) },
      }
    } catch (error) { owned.reverse().forEach(resource => resource.destroy()); throw error }
  })
  return {
    ...base,
    name: `WebGPU grid (${centroidMode} centroids)`,
    readCentroids,
    verifyDivision,
    readContributions,
    diagnose: () => diagnose(),
    readStructure: () => readStructure(),
    setFrame (next): void {
      if (next.slots !== initial.slots) throw new Error('Recreate the backend to change slot count')
      frame = next
    },
  }
}
