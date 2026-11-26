import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { createRoundedKernel } from '../../gpu/rounded-kernel'
import { replaceOnce } from '../many-body-grid/trace'
import { pointerUniform, type Vector } from './data'
import source from './force.wgsl?raw'
import expander from './force-expanded.wgsl?raw'

export type MouseArithmetic = 'native' | 'expanded'
const expandedSource = expander + replaceOnce(source, '  let distance = length(delta);', `
  let maximumDelta = max(abs(delta.x), abs(delta.y));
  let absoluteStrength = abs(params.z);
  // Leave extremes beyond the expansion's distance and numerator range to
  // the original kernel.
  if (maximumDelta >= 1e-12 && maximumDelta <= 1e12 && absoluteStrength >= bitcast<f32>(0x00800000u) && absoluteStrength <= 1e24) {
    forces[index] = vec4f(expandedMouseForce(point.xy, params.xyz), 0., 0.);
    return;
  }
  let distance = length(delta);`)

export async function createMouseWebGPU (
  device: Device, forces: Buffer, ledger?: BufferLedger, arithmetic: MouseArithmetic = 'native'
): Promise<{
  prepare(count: number, world: Vector, strength: number): void;
  encode(pass: ComputePass, positions: Buffer): void;
  destroy(): void;
}> {
  const scope = resourceScope(ledger)
  try {
    const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const bindings = bindingLayout([
      ['positions', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
    ])
    const kernel = scope.own(arithmetic === 'expanded'
      ? await createRoundedKernel(device, expandedSource, bindings)
      : await Kernel.createAsync(device, { source, shaderLayout: { bindings } }))
    let count = 0
    return {
      prepare (next, world, strength): void {
        if (!Number.isInteger(next) || next < 0 || next > forces.byteLength / 16) throw new Error('Invalid pointer force count')
        params.write(new Float32Array([...pointerUniform(world, strength), next]))
        count = next
      },
      encode (pass, positions): void {
        if (count) kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, forces, params } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
