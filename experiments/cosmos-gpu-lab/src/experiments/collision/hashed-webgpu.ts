import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { CollisionParameters } from './data'
import { collisionSlotGrid, collisionSlotUniforms, type CollisionOrigin, type CollisionSlotFrame } from './hashed-grid'
import { collisionSlotBuildSource, collisionSlotForceSource } from './hashed-source'

export async function createCollisionSlotsWebGPU (
  device: Device, sizes: Float32Array, forces: Buffer, settings: CollisionParameters, origin: CollisionOrigin
): Promise<{
    bytes: number;
    prepare(frame: CollisionSlotFrame): void;
    encode(pass: ComputePass, positions: Buffer): void;
    readSlots(): Promise<Uint32Array>;
    destroy(): void;
  }> {
  const grid = collisionSlotGrid(sizes, settings, origin)
  const buckets = grid.edge ** 2
  const workgroups = Math.ceil(sizes.length / 64)
  const bucketGroups = Math.ceil(buckets / 64)
  const scope = resourceScope()
  const own = scope.own
  try {
    const storage = (words: number, readback = false): Buffer => own(device.createBuffer({
      byteLength: words * 4, usage: Buffer.STORAGE | (readback ? Buffer.COPY_SRC : 0),
    }))
    const heads = storage(buckets)
    const next = storage(sizes.length)
    const slots = storage(buckets * grid.capacity, true)
    const sizeBuffer = own(upload(device, sizes))
    const gridParams = own(upload(device, new Uint32Array(8), Buffer.UNIFORM))
    const forceParams = own(upload(device, new Float32Array(8), Buffer.UNIFORM))
    const buildBindings = bindingLayout([
      ['positions', 'read-only-storage'], ['grid', 'uniform'], ['heads', 'storage'], ['next', 'storage'], ['slots', 'storage'],
    ])
    const clear = own(await Kernel.createAsync(device, {
      source: collisionSlotBuildSource, entryPoint: 'clearHeads', shaderLayout: { bindings: buildBindings.slice(2, 3) },
    }))
    const link = own(await Kernel.createAsync(device, {
      source: collisionSlotBuildSource, entryPoint: 'linkPoints', shaderLayout: { bindings: buildBindings.slice(0, 4) },
    }))
    const select = own(await Kernel.createAsync(device, {
      source: collisionSlotBuildSource, entryPoint: 'selectSlots', shaderLayout: { bindings: buildBindings.slice(1) },
    }))
    const force = own(await Kernel.createAsync(device, {
      source: collisionSlotForceSource(),
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
          ['grid', 'uniform'], ['slots', 'read-only-storage'],
        ]),
      },
    }))
    return {
      bytes: [heads, next, slots, sizeBuffer, gridParams, forceParams].reduce((total, buffer) => total + buffer.byteLength, 0),
      prepare (frame): void {
        gridParams.write(collisionSlotUniforms(sizes.length, grid, origin, frame))
        forceParams.write(new Float32Array([sizes.length, settings.strength, settings.radius, settings.padding, 0, frame.alpha, settings.cooling, 0]))
      },
      encode (pass, positions): void {
        clear.dispatch(pass, { x: bucketGroups, bindings: { heads } })
        link.dispatch(pass, { x: workgroups, bindings: { positions, grid: gridParams, heads, next } })
        select.dispatch(pass, { x: bucketGroups, bindings: { grid: gridParams, heads, next, slots } })
        force.dispatch(pass, { x: workgroups, bindings: { positions, sizes: sizeBuffer, params: forceParams, forces, grid: gridParams, slots } })
      },
      async readSlots (): Promise<Uint32Array> {
        const bytes = await slots.readAsync(0, slots.byteLength)
        return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
