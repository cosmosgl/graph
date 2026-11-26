import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { createRoundedKernel, roundedArithmetic } from '../combined-layout/spring-precision'
import { grouping, type ClusterInput } from './data'
import reduction from './reduce.wgsl?raw'
import forceSource from './force.wgsl?raw'

// The force reads current positions from the caller. Only membership, targets
// and scratch sums belong to this stage.
export async function createClusterWebGPU (device: Device, input: ClusterInput, forces: Buffer, ledger?: BufferLedger): Promise<{
  update(input: ClusterInput): void;
  prepare(alpha: number, strength: number): void;
  encode(pass: ComputePass, positions: Buffer): void;
  readAggregates(): Promise<Float32Array>;
  destroy(): void;
}> {
  const count = input.membership.length
  const groups = input.targets.length / 4
  const capacity = Math.ceil(count / 256) + groups
  const scope = resourceScope(ledger); const own = scope.own
  try {
    const storage = (bytes: number): Buffer => own(device.createBuffer({
      byteLength: Math.max(32, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST,
    }))
    const members = storage(count * 4); const chunks = storage(capacity * 16); const ranges = storage(groups * 16)
    const partials = storage(capacity * 32); const dummy = storage(32); const sums = storage(groups * 16)
    const membership = storage(count * 4); const targets = storage(groups * 16); const strengths = storage(count * 4)
    const params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const bindings = bindingLayout([['points', 'read-only-storage'], ['members', 'read-only-storage'], ['ranges', 'read-only-storage'],
      ['previous', 'read-only-storage'], ['partials', 'storage'], ['aggregates', 'storage']])
    const reduce = own(await createRoundedKernel(device, reduction.replaceAll('SOURCE_POINTS', 'true'), bindings))
    const finish = own(await createRoundedKernel(device, reduction.replaceAll('SOURCE_POINTS', 'false'), bindings))
    const force = own(await createRoundedKernel(device, roundedArithmetic + forceSource, bindingLayout([
      ['positions', 'read-only-storage'], ['aggregates', 'read-only-storage'], ['membership', 'read-only-storage'], ['targets', 'read-only-storage'],
      ['strengths', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
    ])))
    let chunkCount = 0
    const update = (next: ClusterInput): void => {
      if (next.membership.length !== count || next.targets.length !== groups * 4) throw new Error('Cluster dimensions require data replacement')
      const index = grouping(next)
      chunkCount = index.chunks.length / 4
      if (index.members.byteLength) members.write(index.members)
      if (index.chunks.byteLength) chunks.write(index.chunks)
      ranges.write(index.ranges); targets.write(next.targets)
      membership.write(next.membership); strengths.write(next.strengths)
    }
    update(input)
    return {
      update,
      prepare (alpha, strength): void { params.write(new Float32Array([count, alpha, strength, 0])) },
      encode (pass, positions): void {
        if (chunkCount) {
          reduce.dispatch(pass, {
            x: chunkCount,
            bindings: { points: positions, members, ranges: chunks, previous: dummy, partials, aggregates: sums },
          })
        }
        finish.dispatch(pass, {
          x: groups,
          bindings: { points: positions, members, ranges, previous: partials, partials: dummy, aggregates: sums },
        })
        force.dispatch(pass, {
          x: Math.ceil(count / 64), bindings: { positions, aggregates: sums, membership, targets, strengths, forces, params },
        })
      },
      readAggregates: (): Promise<Float32Array> => readFloats(sums, groups * 16),
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
