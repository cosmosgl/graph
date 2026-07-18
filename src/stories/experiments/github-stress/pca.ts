/**
 * Client-side PCA of the raw int8 embeddings — no dependency, meant to run in a
 * Web Worker (see pca.worker.ts). At this scale (n≈100k, dim=256) the only
 * expensive step is the covariance, which is a single 256×256 Gram matrix; the
 * eigendecomposition and projection are cheap.
 *
 * Memory-lean: the covariance is accumulated by STREAMING the int8 array (raw
 * Gram Gₐᵦ = Σ xᵢₐxᵢᵦ, then cov = G/n − μμᵀ), so we never materialize the ~200MB
 * mean-centered float copy that a naive PCA (or ml-matrix) would.
 *
 * Produces both artifacts the stress test needs from one pass:
 *   - `reduced`: n × outDim int8, L2-normalized (the kNN input, replaces the
 *     offline PCA-64 bin),
 *   - `init2d`:  n × 2 float, the top-2 PCs (the layout init, replaces init.f32.bin).
 */

export type PcaResult = { reduced: Int8Array; init2d: Float32Array }

const nextTick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

export async function computePca (
  emb: Int8Array,
  n: number,
  dim: number,
  outDim: number,
  onProgress?: (phase: string, fraction: number) => void
): Promise<PcaResult> {
  const CHUNK = 12500

  // ── Means ────────────────────────────────────────────────────────────────
  const mean = new Float64Array(dim)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    for (let d = 0; d < dim; d++) mean[d] = (mean[d] as number) + (emb[o + d] as number)
  }
  for (let d = 0; d < dim; d++) mean[d] = (mean[d] as number) / n

  // ── Raw Gram matrix, streamed from int8 (upper triangle) ──────────────────
  const gram = new Float64Array(dim * dim)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    for (let a = 0; a < dim; a++) {
      const va = emb[o + a] as number
      if (va === 0) continue
      const ra = a * dim
      for (let b = a; b < dim; b++) gram[ra + b] = (gram[ra + b] as number) + va * (emb[o + b] as number)
    }
    if (i % CHUNK === 0) { onProgress?.('Computing covariance', i / n); await nextTick() }
  }

  // ── Covariance = Gram/n − μμᵀ (symmetric) ─────────────────────────────────
  const cov = new Float64Array(dim * dim)
  for (let a = 0; a < dim; a++) {
    for (let b = a; b < dim; b++) {
      const c = (gram[a * dim + b] as number) / n - (mean[a] as number) * (mean[b] as number)
      cov[a * dim + b] = c
      cov[b * dim + a] = c
    }
  }

  // ── Top-outDim eigenvectors: power iteration + Gram-Schmidt deflation ──────
  onProgress?.('Finding components', 0)
  const comps: Float64Array[] = []
  for (let c = 0; c < outDim; c++) {
    let v = new Float64Array(dim)
    for (let d = 0; d < dim; d++) v[d] = Math.sin((d + 1) * (c + 1) * 12.9898) + 0.1
    for (let it = 0; it < 100; it++) {
      const w = new Float64Array(dim)
      for (let a = 0; a < dim; a++) {
        let s = 0
        const ra = a * dim
        for (let b = 0; b < dim; b++) s += (cov[ra + b] as number) * (v[b] as number)
        w[a] = s
      }
      for (const p of comps) {
        let dot = 0
        for (let d = 0; d < dim; d++) dot += (w[d] as number) * (p[d] as number)
        for (let d = 0; d < dim; d++) w[d] = (w[d] as number) - dot * (p[d] as number)
      }
      let norm = 0
      for (let d = 0; d < dim; d++) norm += (w[d] as number) * (w[d] as number)
      norm = Math.sqrt(norm) || 1
      for (let d = 0; d < dim; d++) w[d] = (w[d] as number) / norm
      v = w
    }
    comps.push(v)
    if (c % 8 === 0) { onProgress?.('Finding components', c / outDim); await nextTick() }
  }

  // ── Project onto components → reduced int8 (L2-normalized) + 2D init ──────
  const reduced = new Int8Array(n * outDim)
  const init2d = new Float32Array(n * 2)
  const proj = new Float64Array(outDim)
  for (let i = 0; i < n; i++) {
    const o = i * dim
    for (let c = 0; c < outDim; c++) {
      const comp = comps[c] as Float64Array
      let s = 0
      for (let d = 0; d < dim; d++) s += ((emb[o + d] as number) - (mean[d] as number)) * (comp[d] as number)
      proj[c] = s
    }
    init2d[i * 2] = proj[0] as number
    init2d[i * 2 + 1] = proj[1] as number
    // L2-normalize the reduced vector, then quantize to int8 (cosine metric).
    let norm = 0
    for (let c = 0; c < outDim; c++) norm += (proj[c] as number) * (proj[c] as number)
    norm = Math.sqrt(norm) || 1
    for (let c = 0; c < outDim; c++) {
      const q = Math.round(((proj[c] as number) / norm) * 127)
      reduced[i * outDim + c] = q < -127 ? -127 : q > 127 ? 127 : q
    }
    if (i % CHUNK === 0) { onProgress?.('Projecting', i / n); await nextTick() }
  }

  return { reduced, init2d }
}
