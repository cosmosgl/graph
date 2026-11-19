import { Buffer, type Device } from '@luma.gl/core'
import { readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { PARAMETERS, type Input } from '../many-body/data'
import type { DistantForce } from './resident-cell-field'
import { createResidentHierarchy } from './resident-hierarchy'

export async function frozenForce (device: Device, input: Input, mode: DistantForce): Promise<{ forces: Float32Array; box: Float32Array }> {
  const scope = resourceScope(); const own = scope.own
  try {
    const points = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
    const output = own(device.createBuffer({ byteLength: input.points.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const hierarchy = own(await createResidentHierarchy(device, [points], samples, output, input.points.length / 4, PARAMETERS, 8, mode))
    hierarchy.prepare(0, 1); hierarchy.encodeIndex(0)
    const pass = device.beginComputePass()
    try { hierarchy.encodeForce(pass, 0) } finally { pass.end() }
    device.submit(); await waitForGpu(device, 30000)
    return { forces: await readFloats(output), box: await hierarchy.readBounds() }
  } finally { scope.destroy() }
}
