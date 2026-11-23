import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import { COLLISION_ROTATIONS, collisionRotationSeed } from '@/graph/modules/ForceCollision/collision-grid'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import type { Store } from '@/graph/modules/Store'
import { kernel, upload, type Decl } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import { resourceScope } from '../Shared/resource-scope'
import contacts from './contacts.wgsl?raw'
import hashBuild from './hashed-build.wgsl?raw'
import gridSource from './hashed-grid.wgsl?raw'
import roundedProduct from './rounded-product.wgsl?raw'

const collisionGrid = roundedProduct + gridSource.replace('// @collision-rotations', COLLISION_ROTATIONS.map(([a, b], i) =>
  `const rotation${i === 0 ? 'X' : 'Y'} = vec2u(${a}u, ${b}u);`).join('\n'))

type ContactPass = ForcePass<[sizes: Buffer, forces: Buffer, cfg: GraphConfigInterface, maxSize: number, iteration: number]>
export function createCollision (device: Device, count: number, store: Store): ContactPass {
  const scope = resourceScope()
  const hashed = count > 4096
  try {
    const own = scope.own
    const make = (source: string, name: string, decl: Decl[]): Kernel => kernel(device, scope, source, name, decl)
    const forceBindings: Decl[] = [['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage']]
    if (hashed) forceBindings.push(['grid', 'uniform'], ['slots', 'read-only-storage'])
    const force = make(collisionGrid + contacts, hashed ? 'hashed' : 'exact', forceBindings)
    const edge = getFinestGridSize(count); const capacity = getNearFieldSlotCount(count)
    const storage = (words: number): Buffer => own(device.createBuffer({ byteLength: words * 4, usage: Buffer.STORAGE }))
    const build = collisionGrid + hashBuild
    const hash = hashed
      ? {
        heads: storage(edge * edge),
        next: storage(count),
        slots: storage(edge * edge * capacity),
        clear: make(build, 'clearHeads', [['heads', 'storage', 2]]),
        link: make(build, 'linkPoints', [['positions', 'read-only-storage'], ['grid', 'uniform'], ['heads', 'storage'], ['next', 'storage']]),
        select: make(build, 'selectSlots', [['grid', 'uniform', 1], ['heads', 'storage', 2], ['next', 'storage', 3], ['slots', 'storage', 4]]),
      }
      : undefined
    const params = own(upload(device, new Float32Array(8), Buffer.UNIFORM))
    const grids: Buffer[] = []
    let tick = 0
    return {
      encode (pass: ComputePass, positions: Buffer, sizes: Buffer, forces: Buffer, cfg: GraphConfigInterface, maxSize: number, iteration: number): void {
        const radius = cfg.simulationCollisionRadius ?? 0; const padding = cfg.simulationCollisionPadding
        const maxRadius = (radius > 0 ? radius : maxSize * 0.5) + padding
        if (iteration === 0) {
          params.write(new Float32Array([count, cfg.simulationCollision, radius, padding, maxRadius, store.alpha, cfg.simulationCollisionCooling, 0]))
        }
        const groups = Math.ceil(count / 64)
        if (hash) {
          const grid = grids[iteration] ?? (grids[iteration] = own(upload(device, new Uint32Array(8), Buffer.UNIFORM)))
          const values = new Uint32Array([count, edge, capacity, collisionRotationSeed(tick++), 0, 0, 0, 0])
          new Float32Array(values.buffer).set([...store.worldOrigin, 1 / Math.max(8, 2 * maxRadius), store.getRandomFloat(0, 1)], 4)
          grid.write(values)
          const { heads, next, slots } = hash
          hash.clear.dispatch(pass, { x: Math.ceil(edge * edge / 64), bindings: { heads } })
          hash.link.dispatch(pass, { x: groups, bindings: { positions, grid, heads, next } })
          hash.select.dispatch(pass, { x: Math.ceil(edge * edge / 64), bindings: { grid, heads, next, slots } })
          force.dispatch(pass, { x: groups, bindings: { positions, sizes, params, forces, grid, slots } })
        } else force.dispatch(pass, { x: groups, bindings: { positions, sizes, params, forces } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
