import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import { createSpatialGridResources, formatGridBytes, type SpatialGridBackend } from './resources'

export { formatGridBytes } from './resources'
export type { GridBenchmark, GridReadback, SpatialGridBackend } from './resources'

export async function createSpatialGridBackend (
  positions: Float32Array,
  gridSize: number
): Promise<SpatialGridBackend> {
  const lumaDevice = await luma.createDevice({
    id: `spatial-grid-${positions.length / 2}-${gridSize}`,
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    featureLevel: 'core',
  }) as WebGPUDevice
  let positionBuffer: GPUBuffer | undefined
  try {
    const limits = lumaDevice.handle.limits
    if (positions.byteLength > limits.maxStorageBufferBindingSize || positions.byteLength > limits.maxBufferSize) {
      throw new Error(`positions require ${formatGridBytes(positions.byteLength)}, beyond this device's buffer limit`)
    }
    positionBuffer = lumaDevice.handle.createBuffer({
      label: 'grid positions',
      size: Math.max(4, positions.byteLength),
      usage: 8 | 128,
    })
    lumaDevice.handle.queue.writeBuffer(positionBuffer, 0,
      positions.buffer as ArrayBuffer, positions.byteOffset, positions.byteLength)
    const resources = createSpatialGridResources(lumaDevice.handle, [positionBuffer], positions.length / 2, gridSize)
    return {
      ...resources,
      destroy (): void {
        resources.destroy()
        positionBuffer?.destroy()
        lumaDevice.destroy()
      },
    }
  } catch (error) {
    positionBuffer?.destroy()
    lumaDevice.destroy()
    throw error
  }
}
