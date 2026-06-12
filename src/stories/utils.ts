/**
 * Shared helpers for stories.
 *
 * `generateHyperbolicGraph` builds a Hyperbolic Random Graph (threshold model,
 * T = 0). Nodes are sampled in the native 2D hyperbolic disk: a random angle
 * and a radius drawn so that most nodes sit near the boundary and a few near
 * the center. Two nodes are linked when their hyperbolic distance is <= R.
 * This naturally yields a power-law degree distribution, high clustering, and
 * emergent communities (angular sectors) — the structure that makes real
 * networks look organic once force-laid-out.
 *
 * Efficiency: nodes are sorted by angle and each node only scans an angular
 * window sized by its own radius, so each edge is found once from its more
 * central endpoint. This keeps generation near O(N + E) — fine for ~1M edges.
 */

export interface HyperbolicOptions {
  /** Number of nodes. */
  nodeCount: number;
  /** Target average degree (edges ≈ nodeCount * avgDegree / 2). */
  avgDegree?: number;
  /** Power-law exponent control. Must be > 0.5. Higher = steeper degree tail. */
  alpha?: number;
  /** Coordinate space size (match your GraphConfig.spaceSize). */
  spaceSize?: number;
  /** Optional seed for reproducibility. */
  seed?: number;
}

export interface GeneratedGraphData {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;
  links: Float32Array;
}

/** Mulberry32 PRNG — fast, seedable, good enough for graph generation. */
function makeRng (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hslToRgb (h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/** First index i where arr[i] >= value (lower_bound on a sorted slice). */
function lowerBound (arr: Float64Array, value: number, n: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function generateHyperbolicGraph (options: HyperbolicOptions): GeneratedGraphData {
  const N = options.nodeCount
  const avgDegree = options.avgDegree ?? 14
  const alpha = Math.max(0.5001, options.alpha ?? 0.75)
  const spaceSize = options.spaceSize ?? 8192
  const rng = makeRng(options.seed ?? 0x9e3779b9)

  const TWO_PI = Math.PI * 2

  // Derive disk radius R from the target average degree (Gugelmann/Krioukov approx).
  const xi = (2 / Math.PI) * (alpha / (alpha - 0.5)) ** 2
  const R = 2 * Math.log((xi * N) / avgDegree)
  const coshR = Math.cosh(R)
  const coshAR = Math.cosh(alpha * R)

  // Sample coordinates and precompute cosh/sinh of each radius.
  const theta = new Float64Array(N)
  const radius = new Float64Array(N)
  const coshr = new Float64Array(N)
  const sinhr = new Float64Array(N)

  for (let i = 0; i < N; i++) {
    theta[i] = rng() * TWO_PI
    const u = rng()
    // Inverse CDF of ρ(r) ∝ α·sinh(α·r).
    const r = Math.acosh(1 + u * (coshAR - 1)) / alpha
    radius[i] = r
    coshr[i] = Math.cosh(r)
    sinhr[i] = Math.sinh(r)
  }

  // Sort node indices by angle for windowed neighbor scans.
  const order = new Int32Array(N)
  for (let i = 0; i < N; i++) order[i] = i
  order.sort((a, b) => theta[a]! - theta[b]!)
  const sortedAngles = new Float64Array(N)
  for (let k = 0; k < N; k++) sortedAngles[k] = theta[order[k]!]!

  // Growable edge buffer (flat [src, tgt, src, tgt, ...] indices).
  let edges = new Float32Array(Math.ceil(N * avgDegree * 1.3))
  let edgeLen = 0
  const degree = new Float32Array(N)

  const pushEdge = (a: number, b: number): void => {
    if (edgeLen + 2 > edges.length) {
      const next = new Float32Array(edges.length * 2)
      next.set(edges)
      edges = next
    }
    edges[edgeLen++] = a
    edges[edgeLen++] = b
    degree[a]!++
    degree[b]!++
  }

  // Link i to candidate j; only accept the more-peripheral partner so each
  // edge is created exactly once.
  const tryLink = (i: number, j: number): void => {
    if (j === i) return
    const ri = radius[i]!
    const rj = radius[j]!
    if (rj < ri || (rj === ri && j <= i)) return
    let dt = Math.abs(theta[i]! - theta[j]!)
    if (dt > Math.PI) dt = TWO_PI - dt
    const coshd = coshr[i]! * coshr[j]! - sinhr[i]! * sinhr[j]! * Math.cos(dt)
    if (coshd <= coshR) pushEdge(i, j)
  }

  for (let i = 0; i < N; i++) {
    const ri = radius[i]!
    // Angular reach for node i, assuming partner radius == ri (the widest a
    // valid more-peripheral partner can be).
    let window: number
    if (ri < 1e-9) {
      window = Math.PI
    } else {
      const c = (coshr[i]! * coshr[i]! - coshR) / (sinhr[i]! * sinhr[i]!)
      if (c <= -1) window = Math.PI
      else if (c >= 1) window = 0
      else window = Math.acos(c)
    }

    if (window <= 0) continue

    if (window >= Math.PI) {
      // Hub: scan everyone.
      for (let j = 0; j < N; j++) tryLink(i, j)
      continue
    }

    const a = theta[i]!
    const lo = a - window
    const hi = a + window
    const scan = (from: number, to: number): void => {
      let k = lowerBound(sortedAngles, from, N)
      while (k < N && sortedAngles[k]! < to) {
        tryLink(i, order[k]!)
        k++
      }
    }
    scan(Math.max(0, lo), Math.min(TWO_PI, hi))
    if (lo < 0) scan(TWO_PI + lo, TWO_PI)
    if (hi > TWO_PI) scan(0, hi - TWO_PI)
  }

  // Build point arrays. Position = native polar layout (hubs near center),
  // color = angular sector (communities), size grows with degree.
  const pointPositions = new Float32Array(N * 2)
  const pointColors = new Float32Array(N * 4)
  const pointSizes = new Float32Array(N)
  const center = spaceSize / 2
  const radialScale = (spaceSize / 2) * 0.92 / R

  for (let i = 0; i < N; i++) {
    const rr = radius[i]! * radialScale
    pointPositions[i * 2] = center + rr * Math.cos(theta[i]!)
    pointPositions[i * 2 + 1] = center + rr * Math.sin(theta[i]!)

    const [cr, cg, cb] = hslToRgb(theta[i]! / TWO_PI, 0.6, 0.62)
    pointColors[i * 4] = cr
    pointColors[i * 4 + 1] = cg
    pointColors[i * 4 + 2] = cb
    pointColors[i * 4 + 3] = 1.0

    pointSizes[i] = 1.2 + Math.sqrt(degree[i]!) * 0.6
  }

  return {
    pointPositions,
    pointColors,
    pointSizes,
    links: edges.subarray(0, edgeLen),
  }
}
