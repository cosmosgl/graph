import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import type { CollisionParameters } from './data'
import { collisionSlotGrid, collisionSlotUniforms, type CollisionOrigin, type CollisionSlotFrame } from './hashed-grid'
import { cachedCollisionSlotBuildSource, collisionSlotBuildSource, collisionSlotForceSource, scaledCollisionSlotBuildSource } from './hashed-source'
import type { CollisionCellLookup } from './hashed-source'

export async function createCollisionSlotsWebGPU (
  device: Device, sizes: Float32Array, forces: Buffer, settings: CollisionParameters, origin: CollisionOrigin, ledger?: BufferLedger,
  lookup: CollisionCellLookup = 'direct'
): Promise<{
    bytes: number;
    prepareResize(sizes: Float32Array): () => void;
    prepare(frame: CollisionSlotFrame, iteration?: number): void;
    encode(pass: ComputePass, positions: Buffer, iteration?: number): void;
    readSlots(): Promise<Uint32Array>;
    destroy(): void;
  }> {
  let grid = collisionSlotGrid(sizes, settings, origin)
  const cacheCells = lookup === 'cached'
  // Allocate for the initial tier. A shrink can use a smaller active grid.
  const buckets = grid.edge ** 2
  const capacity = sizes.length
  let count = capacity
  const scope = resourceScope(ledger)
  const own = scope.own
  try {
    const storage = (words: number, readback = false): Buffer => own(device.createBuffer({
      byteLength: words * 4, usage: Buffer.STORAGE | (readback ? Buffer.COPY_SRC : 0),
    }))
    const heads = storage(buckets)
    const next = storage(capacity)
    const slots = storage(buckets * grid.capacity, true)
    const pointCells = cacheCells ? storage(capacity * 2) : undefined
    const sizeBuffer = own(upload(device, sizes))
    // Several iterations can share a command submission. Bind each to its
    // own uniforms so the final queue write cannot replace earlier seeds.
    const uniforms = Array.from({ length: settings.iterations }, () => ({
      grid: own(upload(device, new Uint32Array(8), Buffer.UNIFORM)),
      params: own(upload(device, new Float32Array(8), Buffer.UNIFORM)),
    }))
    const buildBindings = bindingLayout([
      ['positions', 'read-only-storage'], ['grid', 'uniform'], ['heads', 'storage'], ['next', 'storage'], ['slots', 'storage'],
    ])
    const linkBindings = buildBindings.slice(0, 4)
    if (cacheCells) linkBindings.push({ name: 'pointCells', location: 5, group: 0, type: 'storage' })
    const clear = own(await Kernel.createAsync(device, {
      source: collisionSlotBuildSource, entryPoint: 'clearHeads', shaderLayout: { bindings: buildBindings.slice(2, 3) },
    }))
    let linkSource = cacheCells ? cachedCollisionSlotBuildSource : collisionSlotBuildSource
    if (lookup === 'power-of-two') linkSource = scaledCollisionSlotBuildSource
    const link = own(await Kernel.createAsync(device, {
      source: linkSource,
      entryPoint: 'linkPoints',
      shaderLayout: { bindings: linkBindings },
    }))
    const select = own(await Kernel.createAsync(device, {
      source: collisionSlotBuildSource, entryPoint: 'selectSlots', shaderLayout: { bindings: buildBindings.slice(1) },
    }))
    const forceBindings = bindingLayout([
      ['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
      ['grid', 'uniform'], ['slots', 'read-only-storage'],
    ])
    if (cacheCells) forceBindings.push({ name: 'pointCells', location: 6, group: 0, type: 'read-only-storage' })
    const force = own(await Kernel.createAsync(device, { source: collisionSlotForceSource(lookup), shaderLayout: { bindings: forceBindings } }))
    return {
      bytes: [heads, next, slots, sizeBuffer, ...(pointCells ? [pointCells] : []), ...uniforms.flatMap(({ grid, params }) => [grid, params])]
        .reduce((total, buffer) => total + buffer.byteLength, 0),
      prepareResize (sizes): () => void {
        if (sizes.length > capacity) throw new Error('Hashed collision size capacity exceeded')
        const nextGrid = collisionSlotGrid(sizes, settings, origin)
        return (): void => {
          sizeBuffer.write(sizes)
          count = sizes.length
          grid = nextGrid
        }
      },
      prepare (frame, iteration = 0): void {
        const { grid: gridParams, params } = uniforms[iteration]
        gridParams.write(collisionSlotUniforms(count, grid, origin, frame))
        params.write(new Float32Array([count, settings.strength, settings.radius, settings.padding, 0, frame.alpha, settings.cooling, 0]))
      },
      encode (pass, positions, iteration = 0): void {
        const { grid: gridParams, params } = uniforms[iteration]
        const workgroups = Math.ceil(count / 64)
        const bucketGroups = Math.ceil(grid.edge ** 2 / 64)
        const cellBinding: Record<string, Buffer> = pointCells ? { pointCells } : {}
        clear.dispatch(pass, { x: bucketGroups, bindings: { heads } })
        link.dispatch(pass, { x: workgroups, bindings: { positions, grid: gridParams, heads, next, ...cellBinding } })
        select.dispatch(pass, { x: bucketGroups, bindings: { grid: gridParams, heads, next, slots } })
        force.dispatch(pass, { x: workgroups, bindings: { positions, sizes: sizeBuffer, params, forces, grid: gridParams, slots, ...cellBinding } })
      },
      async readSlots (): Promise<Uint32Array> {
        const bytes = await slots.readAsync(0, grid.edge ** 2 * grid.capacity * 4)
        return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
