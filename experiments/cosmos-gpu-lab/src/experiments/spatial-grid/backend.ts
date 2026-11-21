import type { Buffer } from '@luma.gl/core'
import { createDevice, upload } from '../../gpu/luma'
import { createSpatialGridResources, formatGridBytes, type SpatialGridBackend } from './resources'

export { formatGridBytes } from './resources'
export type { GridBenchmark, GridReadback, SpatialGridBackend } from './resources'

export async function createSpatialGridBackend (positions: Float32Array, gridSize: number): Promise<SpatialGridBackend> {
  const device = await createDevice('webgpu')
  let buffer: Buffer | undefined
  try {
    if (positions.byteLength > device.limits.maxStorageBufferBindingSize || positions.byteLength > device.limits.maxBufferSize) {
      throw new Error(`positions require ${formatGridBytes(positions.byteLength)}, beyond this device's buffer limit`)
    }
    buffer = upload(device, positions)
    const resources = createSpatialGridResources(device, [buffer], positions.length / 2, gridSize)
    return { ...resources, destroy (): void { resources.destroy(); buffer?.destroy(); device.destroy() } }
  } catch (error) { buffer?.destroy(); device.destroy(); throw error }
}
