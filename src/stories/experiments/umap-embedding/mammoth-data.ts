/**
 * Data for the 2D Mammoth Projection story: the "understanding-umap" 3D woolly
 * mammoth skeleton point cloud (10 000 points, from
 * https://pair-code.github.io/understanding-umap/mammoth_3d.json). The file is a
 * plain array of [x, y, z] triples with no labels, so the anatomical coloring is
 * computed here by k-means clustering the 3D positions — spatially contiguous
 * clusters read as body parts (legs, trunk, humps, head, tail).
 */

import mammothRaw from './mammoth_3d.json?raw'

export type MammothData = {
  /** `n * 3` row-major 3D coordinates */
  vectors: Float32Array;
  n: number;
}

export const loadMammoth = (): MammothData => {
  const raw = JSON.parse(mammothRaw) as number[][]
  const n = raw.length
  const vectors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const p = raw[i] as number[]
    vectors[i * 3] = p[0] as number
    vectors[i * 3 + 1] = p[1] as number
    vectors[i * 3 + 2] = p[2] as number
  }
  return { vectors, n }
}

/** Small deterministic PRNG so the clustering (and thus colors) is stable across reloads. */
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

/**
 * k-means over the 3D positions (deterministic seeded init + Lloyd iterations).
 * Returns a cluster label per point; since body parts are spatially separated,
 * the clusters land on anatomical regions.
 */
export const kmeansLabels = (vectors: Float32Array, n: number, k: number, iterations = 25): Int32Array => {
  const dim = 3
  const rand = mulberry32(1337)

  // Seeded random distinct initial centroids.
  const centroids = new Float32Array(k * dim)
  const chosen = new Set<number>()
  for (let c = 0; c < k; c++) {
    let idx = Math.floor(rand() * n)
    while (chosen.has(idx)) idx = (idx + 1) % n
    chosen.add(idx)
    for (let d = 0; d < dim; d++) centroids[c * dim + d] = vectors[idx * dim + d] as number
  }

  const labels = new Int32Array(n)
  for (let it = 0; it < iterations; it++) {
    // Assign each point to its nearest centroid.
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < k; c++) {
        let l = 0
        for (let d = 0; d < dim; d++) {
          const df = (vectors[i * dim + d] as number) - (centroids[c * dim + d] as number)
          l += df * df
        }
        if (l < bestDist) {
          bestDist = l
          best = c
        }
      }
      labels[i] = best
    }
    // Recompute centroids.
    const sums = new Float32Array(k * dim)
    const counts = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const c = labels[i] as number
      counts[c] = (counts[c] as number) + 1
      for (let d = 0; d < dim; d++) {
        sums[c * dim + d] = (sums[c * dim + d] as number) + (vectors[i * dim + d] as number)
      }
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue
      for (let d = 0; d < dim; d++) centroids[c * dim + d] = (sums[c * dim + d] as number) / (counts[c] as number)
    }
  }
  return labels
}

/**
 * PCA-style 2D initialization: project the 3D points onto their two
 * highest-variance axes and scale (aspect-preserving) into the center of the
 * space. A structured init is what lets the force simulation unfold the manifold
 * — from a random cloud a dense 2D surface tangles into a hairball it can't
 * escape (real UMAP uses a spectral init for the same reason).
 */
export const coordInit2D = (vectors: Float32Array, n: number, spaceSize: number, fill = 0.55): Float32Array => {
  const dim = 3
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let d = 0; d < dim; d++) mean[d] += vectors[i * dim + d] as number
  for (let d = 0; d < dim; d++) mean[d] = (mean[d] as number) / n
  const variance = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dim; d++) {
      const df = (vectors[i * dim + d] as number) - (mean[d] as number)
      variance[d] = (variance[d] as number) + df * df
    }
  }
  // Two axes with the most spread → the mammoth's side profile.
  const [ax, ay] = [0, 1, 2].sort((a, b) => (variance[b] as number) - (variance[a] as number))
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = vectors[i * dim + (ax as number)] as number
    const y = vectors[i * dim + (ay as number)] as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const extent = Math.max(maxX - minX, maxY - minY) || 1
  const scale = (fill * spaceSize) / extent
  const center = spaceSize / 2
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    positions[i * 2] = center + ((vectors[i * dim + (ax as number)] as number) - cx) * scale
    positions[i * 2 + 1] = center + ((vectors[i * dim + (ay as number)] as number) - cy) * scale
  }
  return positions
}

/** Categorical palette (RGBA 0..1) mapping cluster labels to colors. */
export const labelColors = (labels: Int32Array): Float32Array => {
  const palette = [
    [0.90, 0.80, 0.24], // yellow
    [0.62, 0.15, 0.12], // maroon
    [0.85, 0.20, 0.20], // red
    [0.15, 0.42, 0.20], // dark green
    [0.26, 0.72, 0.70], // cyan
    [0.24, 0.45, 0.78], // steel blue
    [0.10, 0.20, 0.45], // navy
    [0.86, 0.52, 0.22], // orange
    [0.55, 0.35, 0.72], // purple
    [0.40, 0.62, 0.30], // olive green
  ]
  const colors = new Float32Array(labels.length * 4)
  labels.forEach((label, i) => {
    const col = palette[label % palette.length] as number[]
    colors[i * 4] = col[0] as number
    colors[i * 4 + 1] = col[1] as number
    colors[i * 4 + 2] = col[2] as number
    colors[i * 4 + 3] = 1
  })
  return colors
}
