import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { createWebGPU } from '../many-body/webgpu'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { nearLimit, type Input, type Parameters } from '../many-body/data'
import { layout, type Frame, type Structure } from './data'
import type { GridBackend } from './backend'
import shader from './grid.wgsl?raw'
export async function createGridWebGPU (canvas: HTMLCanvasElement, input: Input, p: Parameters, initial: Frame): Promise<GridBackend> {
  let frame = initial
  let readStructure: () => Promise<Structure> = async () => { throw new Error('Grid not initialized') }
  const base = await createWebGPU(canvas, input, p, 'direct', async ({ device, positions, samples, forces, count }) => {
    const owned: Array<{ destroy(): void }> = []
    const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const l = layout(count)
      const storage = (bytes: number): Buffer => own(device.createBuffer({ byteLength: Math.max(16, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const heads = storage(l.cells * 4); const links = storage(l.sizes.length * count * 4)
      const aggregates = storage(l.cells * 16); const slots = storage(l.finest ** 2 * frame.slots * 8)
      const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
      const params = own(upload(device, new Float32Array(12), Buffer.UNIFORM)); const box = own(upload(device, frame.bounds, Buffer.UNIFORM))
      const bindings = bindingLayout([
        ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['heads', 'storage'], ['links', 'storage'],
        ['aggregates', 'storage'], ['slots', 'storage'], ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'], ['box', 'uniform'],
      ])
      const used = [
        ['heads', 'params'],
        ['positions', 'heads', 'links', 'levels', 'params', 'box'],
        ['positions', 'heads', 'links', 'aggregates', 'levels', 'params', 'box'],
        ['heads', 'links', 'slots', 'levels', 'params'],
        ['positions', 'samples', 'aggregates', 'slots', 'forces', 'levels', 'params', 'box'],
      ]
      const kernels: Kernel[] = []
      for (const entryPoint of ['clear', 'linkPoints', 'aggregate', 'selectSlots', 'forceMain']) {
        kernels.push(own(await Kernel.createAsync(device, {
          id: `grid-${entryPoint}`,
          source: shader,
          entryPoint,
          shaderLayout: { bindings: bindings.filter(b => used[kernels.length].includes(b.name)) },
        })))
      }
      readStructure = async (): Promise<Structure> => ({ aggregates: await readFloats(aggregates), slots: await readFloats(slots) })
      return {
        encode (source): void {
          params.write(new Float32Array([count, l.finest, l.sizes.length, frame.slots, p.alpha, p.repulsion, nearLimit(count, p),
            frame.precise ? 1 : 0, frame.seed, l.cells, 0, 0]))
          box.write(frame.bounds)
          const sizes = [l.cells, count, l.cells, l.finest ** 2, count]
          for (const [i, kernel] of kernels.entries()) {
            if (!sizes[i]) continue
            const pass = device.beginComputePass()
            try {
              kernel.dispatch(pass, {
                x: Math.ceil(sizes[i] / 64),
                bindings: Object.fromEntries(Object.entries({
                  positions: positions[source], samples, heads, links, aggregates, slots, forces, levels, params, box,
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
    name: 'WebGPU grid',
    readStructure: () => readStructure(),
    setFrame (next): void {
      if (next.slots !== initial.slots) throw new Error('Recreate the backend to change slot count')
      frame = next
    },
  }
}
