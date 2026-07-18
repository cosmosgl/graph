import { loadHnswlib } from 'hnswlib-wasm'

/**
 * Approximate k-NN via hnswlib-wasm (HNSW index compiled to WebAssembly).
 *
 * Higher recall than the hand-written NN-Descent (~0.95 vs ~0.5) at the cost of
 * a heavier build. Returns `{ indices, distances }` in the same shape `buildKnn`
 * produces (k neighbors per point, nearest first), so `buildUmapGraph` consumes
 * it unchanged. The int8 embeddings are dequantized to float per point; the
 * `cosine` space normalizes internally, so the int8 scale is irrelevant.
 */

export type KnnResult = { indices: Int32Array; distances: Float32Array }

export type HnswOptions = {
  k?: number;
  /** Max outgoing edges per node in the graph. */
  m?: number;
  /** Build-time accuracy/speed tradeoff. */
  efConstruction?: number;
  /** Query-time accuracy/speed tradeoff. */
  efSearch?: number;
  onProgress?: (phase: string, fraction: number) => void;
}

const nextTick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

export async function hnswKnn (
  emb: Int8Array,
  n: number,
  dim: number,
  opts: HnswOptions = {}
): Promise<KnnResult> {
  const k = opts.k ?? 15
  const m = opts.m ?? 16
  const efConstruction = opts.efConstruction ?? 100
  const efSearch = opts.efSearch ?? 48
  // Yield to repaint the progress UI only occasionally: each yield is a
  // setTimeout(0), which background tabs throttle to ~1s, so frequent yields
  // dominate the wall-clock. Coarser yields keep the phase responsive enough.
  const CHUNK = 12500

  const lib = await loadHnswlib()
  const index = new lib.HierarchicalNSW('cosine', dim, '')
  index.initIndex(n, m, efConstruction, 100)

  const buf = new Float32Array(dim)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    for (let d = 0; d < dim; d++) buf[d] = emb[o + d] as number
    index.addPoint(buf, i, false)
    if (i % CHUNK === 0) { opts.onProgress?.('Building HNSW index', i / n); await nextTick() }
  }

  index.setEfSearch(efSearch)
  const indices = new Int32Array(n * k)
  const distances = new Float32Array(n * k)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    for (let d = 0; d < dim; d++) buf[d] = emb[o + d] as number
    const r = index.searchKnn(buf, k + 1, undefined)
    let w = 0
    for (let j = 0; j < r.neighbors.length && w < k; j++) {
      const nb = r.neighbors[j] as number
      if (nb === i) continue // drop self
      indices[i * k + w] = nb
      distances[i * k + w] = r.distances[j] as number
      w++
    }
    // Pad (only if the index returned < k+1 results, which is rare).
    while (w < k) { indices[i * k + w] = i; distances[i * k + w] = 0; w++ }
    if (i % CHUNK === 0) { opts.onProgress?.('Querying neighbors', i / n); await nextTick() }
  }

  return { indices, distances }
}
