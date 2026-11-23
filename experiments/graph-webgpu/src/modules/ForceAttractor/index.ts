import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { GraphData } from '@/graph/modules/GraphData'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import arithmetic from '../Shared/attraction-arithmetic.wgsl?raw'
import attractorSource from './force-attractor.wgsl?raw'

const read = 'read-only-storage'
const write = 'storage'
const uniform = 'uniform'
type Attraction = ForcePass<[forces: Buffer, alpha: number, strength: number]>

export function createAttractors (device: Device, data: GraphData): Attraction | undefined {
  if (!data.pointAttractors) return undefined
  const count = data.pointsNumber!
  const packed = new Float32Array(count * 4)
  let active = false
  for (let i = 0; i < count; i++) {
    const x = data.pointAttractors[2 * i]!; const y = data.pointAttractors[2 * i + 1]!
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const s = data.pointAttractorStrength?.[i]
    packed.set([x, y, s !== undefined && Number.isFinite(s) ? s : 1, 1], i * 4)
    active = true
  }
  if (!active) return undefined
  const scope = resourceScope()
  try {
    const attractors = scope.own(upload(device, packed))
    const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const program = kernel(device, scope, arithmetic + attractorSource, 'main',
      [['positions', read], ['attractors', read], ['forces', write], ['params', uniform]])
    return {
      encode (pass: ComputePass, positions: Buffer, forces: Buffer, alpha: number, strength: number): void {
        params.write(new Float32Array([count, alpha, strength, 0]))
        program.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, attractors, forces, params } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
