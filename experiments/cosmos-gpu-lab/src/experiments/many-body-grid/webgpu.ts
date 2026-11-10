import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { createWebGPU } from '../many-body/webgpu'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { nearLimit, type Input, type Parameters } from '../many-body/data'
import { storedCentroidShader, type CentroidMode } from './centroids'
import { gpuTraceShader, stageNames } from './trace'
import { layout, type Frame, type Structure } from './data'
import type { GridBackend } from './backend'
import shader from './grid.wgsl?raw'
export async function createGridWebGPU (
  canvas: HTMLCanvasElement, input: Input, p: Parameters, initial: Frame, centroidMode: CentroidMode = 'inline'
): Promise<GridBackend> {
  const sourceShader = centroidMode === 'stored' ? storedCentroidShader(shader) : shader
  let readCentroids: (() => Promise<Float32Array>) | undefined
  let frame = initial
  let diagnose: NonNullable<GridBackend['diagnose']>
  let readStructure: () => Promise<Structure> = async () => { throw new Error('Grid not initialized') }
  const base = await createWebGPU(canvas, input, p, 'direct', async ({ device, positions, samples, forces, count }) => {
    const owned: Array<{ destroy(): void }> = []
    const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const l = layout(count)
      const storage = (bytes: number): Buffer => own(device.createBuffer({ byteLength: Math.max(16, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const heads = storage(l.cells * 4); const links = storage(l.sizes.length * count * 4)
      const aggregates = storage(l.cells * 16); const slots = storage(l.finest ** 2 * frame.slots * 8)
      const centroids = centroidMode === 'stored' ? storage(l.cells * 16) : undefined
      if (centroids) readCentroids = (): Promise<Float32Array> => readFloats(centroids)
      const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
      const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM)); const box = own(upload(device, frame.bounds, Buffer.UNIFORM))
      const bindings = bindingLayout([
        ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['heads', 'storage'], ['links', 'storage'],
        ['aggregates', 'storage'], ['slots', 'storage'], ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'], ['box', 'uniform'],
      ])
      if (centroids) bindings.push({ name: 'centroids', location: 11, type: 'storage', group: 0 })
      const forceNames = ['positions', 'samples', 'aggregates', 'slots', 'forces', 'levels', 'params', 'box', ...(centroids ? ['centroids'] : [])]
      const used = [
        ['heads', 'params'],
        ['positions', 'heads', 'links', 'levels', 'params', 'box'],
        ['positions', 'heads', 'links', 'aggregates', 'levels', 'params', 'box'],
        ['heads', 'links', 'slots', 'levels', 'params'],
        ...(centroids ? [['aggregates', 'params', 'centroids']] : []),
        forceNames,
      ]
      const kernels: Kernel[] = []
      for (const entryPoint of ['clear', 'linkPoints', 'aggregate', 'selectSlots', ...(centroids ? ['centroidMain'] : []), 'forceMain']) {
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
                aggregates,
                slots,
                forces: output,
                levels,
                params,
                box,
                trace,
                ...(centroids ? { centroids } : {}),
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
      readStructure = async (): Promise<Structure> => ({ aggregates: await readFloats(aggregates), slots: await readFloats(slots) })
      return {
        encode (source): void {
          lastSource = source
          params.write(new Float32Array([count, l.finest, l.sizes.length, frame.slots, p.alpha, p.repulsion, nearLimit(count, p),
            frame.precise ? 1 : 0, frame.seed, l.cells, 0, 0]))
          box.write(frame.bounds)
          const sizes = [l.cells, count, l.cells, l.finest ** 2, ...(centroids ? [l.cells] : []), count]
          for (const [i, kernel] of kernels.entries()) {
            if (!sizes[i]) continue
            const pass = device.beginComputePass()
            try {
              kernel.dispatch(pass, {
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
                }).filter(([name]) => used[i].includes(name))),
              })
            } finally { pass.end() }
          }
        },
        destroy (): void { owned.reverse().forEach(resource => resource.destroy()) },
      }
    } catch (error) { owned.reverse().forEach(resource => resource.destroy()); throw error }
  })
  return {
    ...base,
    name: `WebGPU grid (${centroidMode} centroids)`,
    readCentroids,
    diagnose: () => diagnose(),
    readStructure: () => readStructure(),
    setFrame (next): void {
      if (next.slots !== initial.slots) throw new Error('Recreate the backend to change slot count')
      frame = next
    },
  }
}
