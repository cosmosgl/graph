/**
 * UMAP's `a` / `b` curve parameters from `minDist` / `spread`.
 *
 * Port of umap-learn's `find_ab_params`: least-squares fit of the smooth
 * membership curve `1 / (1 + a·x^(2b))` to the target
 *   y(x) = 1                              for x < minDist
 *   y(x) = exp(-(x - minDist) / spread)   for x >= minDist
 * sampled on `x ∈ [0, 3·spread]`. Solved here with a small
 * Levenberg-Marquardt loop (SciPy's `curve_fit` is unavailable in the browser).
 *
 * For the defaults (minDist = 0.1, spread = 1.0) this returns
 * a ≈ 1.5769, b ≈ 0.8951, matching umap-learn.
 */
export function findUmapABParams (minDist: number, spread: number): { a: number; b: number } {
  const SAMPLES = 300
  const xs = new Float64Array(SAMPLES)
  const ys = new Float64Array(SAMPLES)
  for (let i = 0; i < SAMPLES; i++) {
    const x = (3 * spread * i) / (SAMPLES - 1)
    xs[i] = x
    ys[i] = x < minDist ? 1 : Math.exp(-(x - minDist) / spread)
  }

  // Model and its partials. At x = 0, x^(2b) = 0 and the log term drops out.
  const model = (x: number, a: number, b: number): number => 1 / (1 + a * Math.pow(x, 2 * b))
  const grad = (x: number, a: number, b: number): [number, number] => {
    if (x <= 0) return [0, 0]
    const p = Math.pow(x, 2 * b)
    const denom = (1 + a * p) * (1 + a * p)
    const dA = -p / denom
    const dB = (-a * p * 2 * Math.log(x)) / denom
    return [dA, dB]
  }

  let a = 1
  let b = 1
  let lambda = 1e-3
  const cost = (aa: number, bb: number): number => {
    let s = 0
    for (let i = 0; i < SAMPLES; i++) {
      const r = model(xs[i] as number, aa, bb) - (ys[i] as number)
      s += r * r
    }
    return s
  }

  let prevCost = cost(a, b)
  for (let iter = 0; iter < 100; iter++) {
    // Normal equations JᵀJ (with LM damping) and Jᵀr.
    let jaa = 0
    let jab = 0
    let jbb = 0
    let ga = 0
    let gb = 0
    for (let i = 0; i < SAMPLES; i++) {
      const x = xs[i] as number
      const r = model(x, a, b) - (ys[i] as number)
      const [da, db] = grad(x, a, b)
      jaa += da * da
      jab += da * db
      jbb += db * db
      ga += da * r
      gb += db * r
    }
    const aDamp = jaa * (1 + lambda)
    const bDamp = jbb * (1 + lambda)
    const det = aDamp * bDamp - jab * jab
    if (Math.abs(det) < 1e-30) break
    const stepA = -(bDamp * ga - jab * gb) / det
    const stepB = -(aDamp * gb - jab * ga) / det

    const newCost = cost(a + stepA, b + stepB)
    if (newCost < prevCost) {
      a += stepA
      b += stepB
      lambda = Math.max(lambda * 0.5, 1e-9)
      if (prevCost - newCost < 1e-12) break
      prevCost = newCost
    } else {
      lambda = Math.min(lambda * 4, 1e7)
    }
  }

  return { a, b }
}
