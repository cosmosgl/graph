/**
 * Memory-lean approximate k-NN for the GitHub-embeddings stress test.
 *
 * This is NN-Descent (Dong et al. 2011) — the same algorithm pynndescent/UMAP
 * use — with a random-projection-forest initialization. It runs entirely in the
 * browser on int8-quantized, PCA-reduced embeddings (cosine metric), so the whole
 * UMAP pipeline is client-side; only the k-neighbor lists live in memory (O(n·k)).
 *
 * Everything is flat typed arrays (no per-point objects → no GC churn):
 *   - each point's k-list is a bounded max-heap in a segment of `idx`/`dst`,
 *     so the worst neighbor is at the root and cheap to evict;
 *   - a "new" flag per slot drives NN-Descent's incremental local join.
 *
 * Returns `{ indices, distances }` in the exact shape `buildKnn` produces (each
 * point's k neighbors sorted ascending by distance), so `buildUmapGraph` consumes
 * it unchanged.
 */

export type KnnResult = { indices: Int32Array; distances: Float32Array }

export type KnnOptions = {
  k?: number;
  trees?: number;
  leafSize?: number;
  maxIter?: number;
  /** Sampling rate for the local join (fraction of k). */
  rho?: number;
  seed?: number;
  /** Called between phases so a host can repaint a progress UI. */
  onProgress?: (phase: string, fraction: number) => void;
}

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const nextTick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

export async function approximateKnn (
  emb: Int8Array,
  n: number,
  dim: number,
  opts: KnnOptions = {}
): Promise<KnnResult> {
  const k = opts.k ?? 15
  const trees = opts.trees ?? 3
  const leafSize = opts.leafSize ?? 30
  const maxIter = opts.maxIter ?? 5
  const rho = opts.rho ?? 0.8
  const rand = mulberry32(opts.seed ?? 42)

  // Per-row int8 vector norm, for the cosine distance below (computed here so the
  // caller doesn't need a separate norms file).
  const norms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    let s = 0
    for (let d = 0; d < dim; d++) { const v = emb[o + d] as number; s += v * v }
    norms[i] = Math.sqrt(s)
  }

  const idx = new Int32Array(n * k)
  const dst = new Float32Array(n * k)
  const flag = new Uint8Array(n * k)
  const len = new Int32Array(n)

  // Cosine distance between rows a and b: 1 - dot / (‖a‖·‖b‖). The int8 dot is
  // the hot loop, unrolled ×8.
  const dist = (a: number, b: number): number => {
    const oa = a * dim
    const ob = b * dim
    let s = 0
    for (let t = 0; t < dim; t += 8) {
      s += (emb[oa + t] as number) * (emb[ob + t] as number) +
        (emb[oa + t + 1] as number) * (emb[ob + t + 1] as number) +
        (emb[oa + t + 2] as number) * (emb[ob + t + 2] as number) +
        (emb[oa + t + 3] as number) * (emb[ob + t + 3] as number) +
        (emb[oa + t + 4] as number) * (emb[ob + t + 4] as number) +
        (emb[oa + t + 5] as number) * (emb[ob + t + 5] as number) +
        (emb[oa + t + 6] as number) * (emb[ob + t + 6] as number) +
        (emb[oa + t + 7] as number) * (emb[ob + t + 7] as number)
    }
    return 1 - s / ((norms[a] as number) * (norms[b] as number))
  }

  const siftUp = (base: number, start: number): void => {
    let p = start
    while (p > 0) {
      const par = (p - 1) >> 1
      if ((dst[base + p] as number) <= (dst[base + par] as number)) break
      const ti = idx[base + p] as number; idx[base + p] = idx[base + par] as number; idx[base + par] = ti
      const td = dst[base + p] as number; dst[base + p] = dst[base + par] as number; dst[base + par] = td
      const tf = flag[base + p] as number; flag[base + p] = flag[base + par] as number; flag[base + par] = tf
      p = par
    }
  }
  const siftDown = (base: number, size: number): void => {
    let p = 0
    for (;;) {
      const l = 2 * p + 1
      const r = l + 1
      let m = p
      if (l < size && (dst[base + l] as number) > (dst[base + m] as number)) m = l
      if (r < size && (dst[base + r] as number) > (dst[base + m] as number)) m = r
      if (m === p) break
      const ti = idx[base + p] as number; idx[base + p] = idx[base + m] as number; idx[base + m] = ti
      const td = dst[base + p] as number; dst[base + p] = dst[base + m] as number; dst[base + m] = td
      const tf = flag[base + p] as number; flag[base + p] = flag[base + m] as number; flag[base + m] = tf
      p = m
    }
  }
  // Insert candidate into node's bounded max-heap. Returns 1 if it was added.
  const push = (node: number, cand: number, d: number): number => {
    const base = node * k
    const L = len[node] as number
    for (let i = 0; i < L; i++) if ((idx[base + i] as number) === cand) return 0
    if (L < k) {
      idx[base + L] = cand; dst[base + L] = d; flag[base + L] = 1; len[node] = L + 1
      siftUp(base, L)
      return 1
    }
    if (d < (dst[base] as number)) {
      idx[base] = cand; dst[base] = d; flag[base] = 1
      siftDown(base, k)
      return 1
    }
    return 0
  }

  // ── Random-projection forest initialization ──────────────────────────────
  // Recursively split points by a random hyperplane (direction = difference of
  // two random points); points that land together in a small leaf become mutual
  // candidates. A few trees give NN-Descent a warm start.
  const dir = new Int16Array(dim)
  const proj = new Float64Array(n)
  const order = new Int32Array(n)
  const buildTree = (lo: number, hi: number): void => {
    if (hi - lo <= leafSize) {
      for (let i = lo; i < hi; i++) {
        const a = order[i] as number
        for (let j = i + 1; j < hi; j++) {
          const b = order[j] as number
          const d = dist(a, b)
          push(a, b, d); push(b, a, d)
        }
      }
      return
    }
    const pa = order[lo + Math.floor(rand() * (hi - lo))] as number
    const pb = order[lo + Math.floor(rand() * (hi - lo))] as number
    for (let t = 0; t < dim; t++) dir[t] = (emb[pa * dim + t] as number) - (emb[pb * dim + t] as number)
    for (let i = lo; i < hi; i++) {
      const x = order[i] as number
      const ox = x * dim
      let s = 0
      for (let t = 0; t < dim; t++) s += (emb[ox + t] as number) * (dir[t] as number)
      proj[x] = s
    }
    const slice = Array.from(order.subarray(lo, hi)).sort((a, b) => (proj[a] as number) - (proj[b] as number))
    for (let i = 0; i < slice.length; i++) order[lo + i] = slice[i] as number
    const mid = (lo + hi) >> 1
    buildTree(lo, mid)
    buildTree(mid, hi)
  }
  for (let tr = 0; tr < trees; tr++) {
    for (let i = 0; i < n; i++) order[i] = i
    buildTree(0, n)
    opts.onProgress?.('Building RP-forest', (tr + 1) / trees)
    await nextTick()
  }
  // Any point still short of k neighbors (tiny leaves) gets random fill.
  for (let u = 0; u < n; u++) {
    while ((len[u] as number) < k) {
      let v = Math.floor(rand() * n)
      if (v === u) v = (v + 1) % n
      push(u, v, dist(u, v))
    }
  }

  // ── NN-Descent refinement ─────────────────────────────────────────────────
  const newCap = Math.max(2, Math.ceil(rho * k))
  const oldCap = k
  const revCap = Math.max(2, Math.ceil(rho * k))
  const sNew = new Int32Array(n * newCap); const sNewLen = new Int32Array(n)
  const sOld = new Int32Array(n * oldCap); const sOldLen = new Int32Array(n)
  const rNew = new Int32Array(n * revCap); const rNewLen = new Int32Array(n)
  const rOld = new Int32Array(n * revCap); const rOldLen = new Int32Array(n)
  const newBuf = new Int32Array(newCap + revCap)
  const oldBuf = new Int32Array(oldCap + revCap)

  for (let it = 0; it < maxIter; it++) {
    sNewLen.fill(0); sOldLen.fill(0); rNewLen.fill(0); rOldLen.fill(0)
    // Sample "new" (and consume their flag) and "old" neighbors per point.
    for (let u = 0; u < n; u++) {
      const base = u * k
      const L = len[u] as number
      for (let p = 0; p < L; p++) {
        const v = idx[base + p] as number
        if ((flag[base + p] as number) === 1) {
          if ((sNewLen[u] as number) < newCap) { sNew[u * newCap + (sNewLen[u] as number)] = v; sNewLen[u] = (sNewLen[u] as number) + 1; flag[base + p] = 0 }
        } else if ((sOldLen[u] as number) < oldCap) { sOld[u * oldCap + (sOldLen[u] as number)] = v; sOldLen[u] = (sOldLen[u] as number) + 1 }
      }
    }
    // Reverse (sampled) adjacency.
    for (let u = 0; u < n; u++) {
      const nl = sNewLen[u] as number
      for (let a = 0; a < nl; a++) {
        const v = sNew[u * newCap + a] as number
        if ((rNewLen[v] as number) < revCap) { rNew[v * revCap + (rNewLen[v] as number)] = u; rNewLen[v] = (rNewLen[v] as number) + 1 }
      }
      const ol = sOldLen[u] as number
      for (let a = 0; a < ol; a++) {
        const v = sOld[u * oldCap + a] as number
        if ((rOldLen[v] as number) < revCap) { rOld[v * revCap + (rOldLen[v] as number)] = u; rOldLen[v] = (rOldLen[v] as number) + 1 }
      }
    }
    // Local join: new×new and new×old around each point.
    let c = 0
    for (let u = 0; u < n; u++) {
      let nb = 0
      const snl = sNewLen[u] as number
      for (let a = 0; a < snl; a++) { newBuf[nb] = sNew[u * newCap + a] as number; nb++ }
      const rnl = rNewLen[u] as number
      for (let a = 0; a < rnl; a++) { newBuf[nb] = rNew[u * revCap + a] as number; nb++ }
      let ob = 0
      const sol = sOldLen[u] as number
      for (let a = 0; a < sol; a++) { oldBuf[ob] = sOld[u * oldCap + a] as number; ob++ }
      const rol = rOldLen[u] as number
      for (let a = 0; a < rol; a++) { oldBuf[ob] = rOld[u * revCap + a] as number; ob++ }
      for (let a = 0; a < nb; a++) {
        const x = newBuf[a] as number
        for (let b = a + 1; b < nb; b++) {
          const y = newBuf[b] as number
          if (x !== y) { const d = dist(x, y); c += push(x, y, d) + push(y, x, d) }
        }
        for (let b = 0; b < ob; b++) {
          const y = oldBuf[b] as number
          if (x !== y) { const d = dist(x, y); c += push(x, y, d) + push(y, x, d) }
        }
      }
    }
    opts.onProgress?.('Refining neighbors', (it + 1) / maxIter)
    await nextTick()
    if (c < n * k * 0.001) break // converged: almost no updates
  }

  // Sort each point's list ascending (buildUmapGraph expects nearest first).
  for (let u = 0; u < n; u++) {
    const base = u * k
    const L = len[u] as number
    const ord = Array.from({ length: L }, (_, i) => i).sort((p, q) => (dst[base + p] as number) - (dst[base + q] as number))
    const ti = ord.map((o) => idx[base + o] as number)
    const td = ord.map((o) => dst[base + o] as number)
    for (let p = 0; p < L; p++) { idx[base + p] = ti[p] as number; dst[base + p] = td[p] as number }
  }

  return { indices: idx, distances: dst }
}
