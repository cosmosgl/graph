import type { CentroidMode } from './centroids'
import { layout } from './data'
export function farResources (count: number, mode: CentroidMode): { extraStorageBytes: number; extraDispatches: number } {
  const l = layout(count)
  const centroids = mode === 'inline' ? 0 : l.cells * 16
  const contributions = mode === 'materialized'
    ? count * l.sizes.length * 100 * 8
    : mode === 'streamed' ? count * (100 + l.sizes.length) * 8 : 0
  return {
    extraStorageBytes: centroids + contributions,
    extraDispatches: mode === 'inline' ? 0 : mode === 'materialized' ? 2 : mode === 'streamed' ? 1 + 2 * l.sizes.length : 1,
  }
}
