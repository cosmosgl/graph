import type { CentroidMode } from './centroids'
import { layout } from './data'
export const DEFAULT_FAR_CHUNK_SIZE = 16384
export function farResources (count: number, mode: CentroidMode, chunkSize = DEFAULT_FAR_CHUNK_SIZE): {
  extraStorageBytes: number; extraDispatches: number;
} {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('Invalid far-field chunk size')
  const l = layout(count)
  const centroids = mode === 'inline' ? 0 : l.cells * 16
  const contributions = mode === 'materialized'
    ? count * l.sizes.length * 100 * 8
    : mode === 'streamed'
      ? count * (100 + l.sizes.length) * 8
      : mode === 'chunked' ? (Math.min(count, chunkSize) * 100 + count * l.sizes.length) * 8 : 0
  return {
    extraStorageBytes: centroids + contributions,
    extraDispatches: mode === 'inline'
      ? 0
      : mode === 'materialized'
        ? 2
        : mode === 'streamed'
          ? 1 + 2 * l.sizes.length
          : mode === 'chunked' ? 1 + 2 * l.sizes.length * Math.ceil(count / chunkSize) : 1,
  }
}
