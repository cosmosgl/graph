/**
 * UMAP graph construction for the embedding stories: brute-force kNN over the
 * input vectors, smooth-kNN calibration (the fuzzy simplicial set), and
 * symmetrization. The resulting graph feeds cosmos.gl via `setLinks` (neighbor
 * pairs) and `setLinkStrength` (fuzzy edge weights) — the GPU simulation with
 * `simulationKernel: 'umap'` does the actual optimization.
 */

export type UmapGraph = {
  /** Undirected neighbor pairs, `[src0, tgt0, src1, tgt1, …]` */
  links: Float32Array;
  /** Symmetrized fuzzy weight per pair, in (0, 1] */
  strengths: Float32Array;
}

/**
 * PCA initialization: project the (possibly high-dimensional) input vectors onto
 * their top `outDim` principal components and scale (aspect-preserving) into the
 * center of the space. A structured init is what lets the force simulation refine
 * a coherent layout instead of untangling a random hairball — the reason real
 * UMAP uses a spectral/PCA init. Returns `n * outDim` row-major positions
 * (`outDim` = 2 for a 2D embedding, 3 for 3D).
 *
 * Components come from power iteration with Gram-Schmidt deflation on the
 * `dim × dim` covariance matrix (cheap: dim is small here). The init vectors are
 * deterministic, so the result is stable across reloads.
 */
export const pcaInit = (
  vectors: Float32Array,
  n: number,
  dim: number,
  outDim: number,
  spaceSize: number,
  fill = 0.55
): Float32Array => {
  // Mean-center.
  const mean = new Float64Array(dim)
  for (let i = 0; i < n; i++) for (let d = 0; d < dim; d++) mean[d] = (mean[d] as number) + (vectors[i * dim + d] as number)
  for (let d = 0; d < dim; d++) mean[d] = (mean[d] as number) / n
  const centered = new Float64Array(n * dim)
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dim; d++) centered[i * dim + d] = (vectors[i * dim + d] as number) - (mean[d] as number)
  }

  // Covariance (symmetric dim × dim).
  const cov = new Float64Array(dim * dim)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < dim; a++) {
      const va = centered[i * dim + a] as number
      if (va === 0) continue
      for (let b = a; b < dim; b++) cov[a * dim + b] = (cov[a * dim + b] as number) + va * (centered[i * dim + b] as number)
    }
  }
  for (let a = 0; a < dim; a++) {
    for (let b = a; b < dim; b++) {
      const v = (cov[a * dim + b] as number) / n
      cov[a * dim + b] = v
      cov[b * dim + a] = v
    }
  }

  // Top-outDim eigenvectors via power iteration + deflation against earlier ones.
  const comps: Float64Array[] = []
  for (let c = 0; c < outDim; c++) {
    let v = new Float64Array(dim)
    // Deterministic, non-degenerate start (varies per component).
    for (let d = 0; d < dim; d++) v[d] = Math.sin((d + 1) * (c + 1) * 12.9898) + 0.1
    for (let it = 0; it < 100; it++) {
      const w = new Float64Array(dim)
      for (let a = 0; a < dim; a++) {
        let s = 0
        for (let b = 0; b < dim; b++) s += (cov[a * dim + b] as number) * (v[b] as number)
        w[a] = s
      }
      // Orthogonalize against already-found components.
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
  }

  // Project onto the components and rescale (aspect-preserving) into the space.
  const proj = new Float64Array(n * outDim)
  const min = new Float64Array(outDim).fill(Infinity)
  const max = new Float64Array(outDim).fill(-Infinity)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < outDim; c++) {
      let s = 0
      const comp = comps[c] as Float64Array
      for (let d = 0; d < dim; d++) s += (centered[i * dim + d] as number) * (comp[d] as number)
      proj[i * outDim + c] = s
      if (s < (min[c] as number)) min[c] = s
      if (s > (max[c] as number)) max[c] = s
    }
  }
  let extent = 0
  for (let c = 0; c < outDim; c++) extent = Math.max(extent, (max[c] as number) - (min[c] as number))
  extent = extent || 1
  const scale = (fill * spaceSize) / extent
  const center = spaceSize / 2
  const out = new Float32Array(n * outDim)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < outDim; c++) {
      const mid = ((min[c] as number) + (max[c] as number)) / 2
      out[i * outDim + c] = center + ((proj[i * outDim + c] as number) - mid) * scale
    }
  }
  return out
}

/** Brute-force exact kNN: per-point neighbor indices and distances, ascending. */
export const buildKnn = (vectors: Float32Array, dim: number, k: number): { indices: Int32Array; distances: Float32Array } => {
  const n = vectors.length / dim
  const indices = new Int32Array(n * k).fill(-1)
  const distances = new Float32Array(n * k).fill(Infinity)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let l2 = 0
      for (let d = 0; d < dim; d++) {
        const diff = (vectors[i * dim + d] as number) - (vectors[j * dim + d] as number)
        l2 += diff * diff
      }
      const dist = Math.sqrt(l2)
      // Insert into both points' sorted k-nearest lists.
      for (const [self, other] of [[i, j], [j, i]] as const) {
        const base = self * k
        if (dist >= (distances[base + k - 1] as number)) continue
        let pos = k - 1
        while (pos > 0 && (distances[base + pos - 1] as number) > dist) {
          distances[base + pos] = distances[base + pos - 1] as number
          indices[base + pos] = indices[base + pos - 1] as number
          pos--
        }
        distances[base + pos] = dist
        indices[base + pos] = other
      }
    }
  }
  return { indices, distances }
}

/**
 * Smooth-kNN calibration + symmetrization (umap-learn's fuzzy simplicial set):
 * per point, binary-search σᵢ so that Σⱼ exp(-(dᵢⱼ - ρᵢ)/σᵢ) = log₂(k) with
 * ρᵢ the nearest-neighbor distance, then fuzzy-union the two directions
 * (w = wᵢⱼ + wⱼᵢ - wᵢⱼ·wⱼᵢ).
 */
export const buildUmapGraph = (
  knn: { indices: Int32Array; distances: Float32Array },
  n: number,
  k: number
): UmapGraph => {
  const { indices, distances } = knn
  const target = Math.log2(k)
  const directed = new Map<number, number>()

  for (let i = 0; i < n; i++) {
    const base = i * k
    const rho = distances[base] as number

    let lo = 0
    let hi = Infinity
    let sigma = 1
    for (let iter = 0; iter < 64; iter++) {
      let sum = 0
      for (let s = 0; s < k; s++) {
        const d = Math.max(0, (distances[base + s] as number) - rho)
        sum += Math.exp(-d / sigma)
      }
      if (Math.abs(sum - target) < 1e-5) break
      if (sum > target) {
        hi = sigma
        sigma = (lo + hi) / 2
      } else {
        lo = sigma
        sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2
      }
    }

    for (let s = 0; s < k; s++) {
      const j = indices[base + s] as number
      if (j < 0) continue
      const d = Math.max(0, (distances[base + s] as number) - rho)
      directed.set(i * n + j, Math.exp(-d / sigma))
    }
  }

  const links: number[] = []
  const strengths: number[] = []
  for (const [key, wij] of directed) {
    const i = Math.floor(key / n)
    const j = key % n
    if (j < i && directed.has(j * n + i)) continue // handled from the (j, i) side
    const wji = directed.get(j * n + i) ?? 0
    const w = wij + wji - wij * wji
    if (w < 0.01) continue
    links.push(i, j)
    strengths.push(w)
  }
  return { links: new Float32Array(links), strengths: new Float32Array(strengths) }
}

/** First kTo (nearest) neighbors of each point's kFrom-long sorted kNN lists. */
export const sliceKnnLists = (
  knn: { indices: Int32Array; distances: Float32Array },
  n: number,
  kFrom: number,
  kTo: number
): { indices: Int32Array; distances: Float32Array } => {
  const indices = new Int32Array(n * kTo)
  const distances = new Float32Array(n * kTo)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < kTo; j++) {
      indices[i * kTo + j] = knn.indices[i * kFrom + j] as number
      distances[i * kTo + j] = knn.distances[i * kFrom + j] as number
    }
  }
  return { indices, distances }
}

/**
 * t-SNE input probabilities from the kNN lists (van der Maaten's Barnes-Hut
 * formulation): per point, binary-search the Gaussian precision βᵢ so that the
 * conditional distribution p_j|i over its k neighbors has the target perplexity
 * (2^H = perplexity), then symmetrize p_ij = (p_j|i + p_i|j) / (2n). Feed the
 * result to cosmos via `setLinks` + `setLinkStrength` with
 * `simulationKernel: 'tsne'`. Use k ≈ 3 · perplexity, as in Barnes-Hut t-SNE.
 */
export const buildTsneGraph = (
  knn: { indices: Int32Array; distances: Float32Array },
  n: number,
  k: number,
  perplexity = 30
): UmapGraph => {
  const { indices, distances } = knn
  const targetEntropy = Math.log(perplexity) // nats
  const directed = new Map<number, number>()
  const p = new Float64Array(k)

  for (let i = 0; i < n; i++) {
    const base = i * k
    // Squared distances, shifted by the smallest for numerical stability
    // (shifting cancels out in the normalized probabilities).
    const d0 = (distances[base] as number) ** 2

    let lo = 0
    let hi = Infinity
    let beta = 1
    for (let iter = 0; iter < 64; iter++) {
      let sum = 0
      for (let s = 0; s < k; s++) {
        const d2 = (distances[base + s] as number) ** 2 - d0
        p[s] = Math.exp(-beta * d2)
        sum += p[s] as number
      }
      let entropy = 0
      for (let s = 0; s < k; s++) {
        const prob = (p[s] as number) / sum
        if (prob > 1e-12) entropy -= prob * Math.log(prob)
      }
      if (Math.abs(entropy - targetEntropy) < 1e-5) break
      if (entropy > targetEntropy) {
        // Too spread out — sharpen the Gaussian.
        lo = beta
        beta = hi === Infinity ? beta * 2 : (lo + hi) / 2
      } else {
        hi = beta
        beta = (lo + hi) / 2
      }
    }

    let sum = 0
    for (let s = 0; s < k; s++) sum += p[s] as number
    for (let s = 0; s < k; s++) {
      const j = indices[base + s] as number
      if (j < 0) continue
      directed.set(i * n + j, (p[s] as number) / sum)
    }
  }

  const links: number[] = []
  const strengths: number[] = []
  for (const [key, pij] of directed) {
    const i = Math.floor(key / n)
    const j = key % n
    if (j < i && directed.has(j * n + i)) continue // handled from the (j, i) side
    const pji = directed.get(j * n + i) ?? 0
    const pSym = (pij + pji) / (2 * n)
    if (pSym <= 0) continue
    links.push(i, j)
    strengths.push(pSym)
  }
  return { links: new Float32Array(links), strengths: new Float32Array(strengths) }
}
