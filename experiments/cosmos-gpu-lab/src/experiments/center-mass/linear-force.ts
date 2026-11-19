import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, upload } from '../../gpu/luma'
import source from '../combined-layout/center-force-linear.wgsl?raw'

export async function createLinearCenterForce (
  device: Device, count: number, positions: Buffer, forces: Buffer, center: Buffer
): Promise<{ encode(pass: ComputePass, alpha: number, strength: number): void; destroy(): void }> {
  const params = upload(device, new Float32Array([count, 1, 1, 0]), Buffer.UNIFORM)
  let kernel: Kernel
  try {
    kernel = await Kernel.createAsync(device, {
      source,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'], ['centermass', 'read-only-storage'],
        ]),
      },
    })
  } catch (error) { params.destroy(); throw error }
  return {
    encode (pass, alpha, strength): void {
      params.write(new Float32Array([count, alpha, strength, 0]))
      kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, params, forces, centermass: center } })
    },
    destroy (): void { kernel.destroy(); params.destroy() },
  }
}
