import type { Buffer } from '@luma.gl/core'
import { createDevice, upload } from '../../gpu/luma'
import { checkStorageSize, createSpatialGridResources, type SpatialGridBackend } from './resources'

export { formatGridBytes } from './resources'
export type { GridBenchmark, GridReadback, SpatialGridBackend } from './resources'

export class GridDeviceUnavailable extends Error {}
type StandaloneGrid = SpatialGridBackend & { updatePositions(positions: Float32Array): void }

export async function createSpatialGridBackend (
  positions: Float32Array, gridSize: number, onError?: (error: Error) => void, signal?: AbortSignal
): Promise<StandaloneGrid> {
  const device = await createDevice('webgpu', undefined, false, onError).catch((cause: unknown) => {
    throw new GridDeviceUnavailable(`WebGPU device unavailable. ${cause instanceof Error ? cause.message : String(cause)}`)
  })
  let buffer: Buffer | undefined
  try {
    signal?.throwIfAborted()
    checkStorageSize(device, 'Position buffer', Math.max(16, positions.byteLength))
    buffer = upload(device, positions)
    const resources = await createSpatialGridResources(device, [buffer], positions.length / 2, gridSize)
    const positionBuffer = buffer
    return {
      ...resources,
      updatePositions (next): void {
        if (next.length !== resources.pointCount * 2) throw new Error('A grid update must preserve the point count.')
        positionBuffer.write(next)
      },
      destroy (): void { resources.destroy(); positionBuffer.destroy(); device.destroy() },
    }
  } catch (error) { buffer?.destroy(); device.destroy(); throw error }
}
