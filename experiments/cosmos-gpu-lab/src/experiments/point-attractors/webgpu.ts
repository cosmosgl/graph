import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { createRoundedKernel, roundedArithmetic } from '../combined-layout/spring-precision'
import forceSource from './force.wgsl?raw'

export async function createAttractorWebGPU (device: Device, count: number, forces: Buffer, ledger?: BufferLedger): Promise<{
  update(values: Float32Array): void;
  prepare(alpha: number, strength: number): void;
  encode(pass: ComputePass, positions: Buffer): void;
  destroy(): void;
}> {
  const scope = resourceScope(ledger); const own = scope.own
  try {
    const attractors = own(upload(device, new Float32Array(count * 4)))
    const params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const force = own(await createRoundedKernel(device, roundedArithmetic + forceSource, bindingLayout([
      ['positions', 'read-only-storage'], ['attractors', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
    ])))
    return {
      update (values): void {
        if (values.length !== count * 4) throw new Error('Attractor dimensions require data replacement')
        attractors.write(values)
      },
      prepare (alpha, strength): void { params.write(new Float32Array([count, alpha, strength, 0])) },
      encode (pass, positions): void {
        force.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, attractors, forces, params } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
