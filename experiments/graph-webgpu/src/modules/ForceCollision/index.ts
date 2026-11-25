import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import { COLLISION_ROTATIONS, collisionRotationSeed } from '@/graph/modules/ForceCollision/collision-grid'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import type { Store } from '@/graph/modules/Store'
import { kernel, upload, type Decl } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import { resourceScope } from '../Shared/resource-scope'
import roundedProduct from '../Shared/rounded-product.wgsl?raw'
import cellSlots from '../Shared/select-cell-slots.wgsl?raw'
import contacts from './contacts.wgsl?raw'
import hashBuild from './hashed-build.wgsl?raw'
import gridSource from './hashed-grid.wgsl?raw'

const collisionGrid = roundedProduct + gridSource.replace('// @collision-rotations', COLLISION_ROTATIONS.map(([a, b], i) =>
  `const rotation${i === 0 ? 'X' : 'Y'} = vec2u(${a}u, ${b}u);`).join('\n'))

type ContactPass = ForcePass<[sizes: Buffer, forces: Buffer, cfg: GraphConfigInterface, maxSize: number, iteration: number]>
type CollisionHash = {
  edge: number;
  capacity: number;
  heads: Buffer;
  next: Buffer;
  slots: Buffer;
  clear: Kernel;
  link: Kernel;
  select: Kernel;
}

export class ForceCollision implements ContactPass {
  private readonly scope = resourceScope()
  private readonly force: Kernel
  private readonly params: Buffer
  private readonly hash?: CollisionHash
  private readonly iterationGrids: Buffer[] = []
  private tick = 0

  public constructor (private readonly device: Device, private readonly count: number, private readonly store: Store) {
    const hashed = count > 4096
    const make = (source: string, name: string, decl: Decl[]): Kernel => kernel(device, this.scope, source, name, decl)
    try {
      const forceBindings: Decl[] = [['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage']]
      if (hashed) forceBindings.push(['grid', 'uniform'], ['slots', 'read-only-storage'])
      this.force = make(collisionGrid + contacts, hashed ? 'hashed' : 'exact', forceBindings)

      if (hashed) {
        const edge = getFinestGridSize(count)
        const capacity = getNearFieldSlotCount(count)
        const storage = (words: number): Buffer => this.scope.own(device.createBuffer({ byteLength: words * 4, usage: Buffer.STORAGE }))
        const build = [collisionGrid, hashBuild, `const maxCellSlots = ${capacity}u;`, cellSlots].join('\n')
        this.hash = {
          edge,
          capacity,
          heads: storage(edge * edge),
          next: storage(count),
          slots: storage(edge * edge * capacity),
          clear: make(build, 'clearHeads', [['heads', 'storage', 2]]),
          link: make(build, 'linkPoints', [['positions', 'read-only-storage'], ['grid', 'uniform'], ['heads', 'storage'], ['next', 'storage']]),
          select: make(build, 'selectSlots', [['grid', 'uniform', 1], ['heads', 'storage', 2], ['next', 'storage', 3], ['slots', 'storage', 4]]),
        }
      }
      this.params = this.scope.own(upload(device, new Float32Array(8), Buffer.UNIFORM))
    } catch (error) {
      this.scope.destroy()
      throw error
    }
  }

  public encode (
    pass: ComputePass, positions: Buffer, sizes: Buffer, forces: Buffer,
    config: GraphConfigInterface, maxResolvedSize: number, iteration: number
  ): void {
    const { count, store, params, hash } = this
    const radius = config.simulationCollisionRadius ?? 0
    const padding = config.simulationCollisionPadding
    const maxRadius = (radius > 0 ? radius : maxResolvedSize * 0.5) + padding
    if (iteration === 0) {
      params.write(new Float32Array([count, config.simulationCollision, radius, padding, maxRadius, store.alpha, config.simulationCollisionCooling, 0]))
    }
    const groups = Math.ceil(count / 64)
    if (!hash) {
      this.force.dispatch(pass, { x: groups, bindings: { positions, sizes, params, forces } })
      return
    }

    // Each iteration in this compute pass needs its own rotation and random sample.
    const grid = this.iterationGrids[iteration] ??= this.scope.own(upload(this.device, new Uint32Array(8), Buffer.UNIFORM))
    const { edge, capacity, heads, next, slots } = hash
    const values = new Uint32Array([count, edge, capacity, collisionRotationSeed(this.tick++), 0, 0, 0, 0])
    new Float32Array(values.buffer).set([...store.worldOrigin, 1 / Math.max(8, 2 * maxRadius), store.getRandomFloat(0, 1)], 4)
    grid.write(values)
    const cellGroups = Math.ceil(edge * edge / 64)
    hash.clear.dispatch(pass, { x: cellGroups, bindings: { heads } })
    hash.link.dispatch(pass, { x: groups, bindings: { positions, grid, heads, next } })
    hash.select.dispatch(pass, { x: cellGroups, bindings: { grid, heads, next, slots } })
    this.force.dispatch(pass, { x: groups, bindings: { positions, sizes, params, forces, grid, slots } })
  }

  public destroy (): void {
    this.scope.destroy()
  }
}
