/** Fits the image into the scene with a small margin. */
function getPictureLayoutRect (
  spaceSize: number,
  aspect: number
): { left: number; top: number; w: number; h: number } {
  const margin = spaceSize * 0.032
  const inner = spaceSize - 2 * margin
  let w: number
  let h: number

  if (aspect >= 1) {
    w = inner * 0.98
    h = w / aspect
  } else {
    h = inner * 0.98
    w = h * aspect
  }

  const cx = spaceSize / 2
  const cy = spaceSize / 2
  return { left: cx - w / 2, top: cy - h / 2, w, h }
}

/** Generates the photo point layout on the fitted image rect. */
export function createPicturePositions (
  cols: number,
  rows: number,
  spaceSize: number,
  aspect: number
): Float32Array {
  const { left, top, w, h } = getPictureLayoutRect(spaceSize, aspect)
  const out = new Float32Array(cols * rows * 2)
  let p = 0

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const u = cols > 1 ? col / (cols - 1) : 0.5
      const v = rows > 1 ? row / (rows - 1) : 0.5
      out[p] = left + u * w
      out[p + 1] = top + v * h
      p += 2
    }
  }

  return out
}
/** Stable fractional pseudo-random number in [0, 1) from integer key. */
function hash01 (key: number): number {
  const x = Math.sin(key * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Pre-reveal scatter where points are clustered by color into blobs
 * placed at random spots across the space.
 *
 * For each point we quantize its RGB into a coarse bucket; each bucket
 * gets a deterministic (bucket-seeded) center and radius; the point
 * lands somewhere inside that disk. The result is a field of colored
 * patches — the picture's palette disassembled across space — that then
 * reassembles into the image on the transition.
 */
export function createColorClusteredScatterPositions (
  cols: number,
  rows: number,
  spaceSize: number,
  colors: Float32Array
): Float32Array {
  const total = cols * rows
  const out = new Float32Array(total * 2)

  // 4 levels/channel → up to 64 color buckets. Coarse enough that
  // visually-similar pixels land in the same blob.
  const levels = 4
  const quantize = (v: number): number =>
    Math.min(levels - 1, Math.max(0, Math.floor(v * levels)))
  const bucketKey = (i: number): number => {
    const r = colors[i * 4] ?? 0
    const g = colors[i * 4 + 1] ?? 0
    const b = colors[i * 4 + 2] ?? 0
    return quantize(r) * levels * levels + quantize(g) * levels + quantize(b)
  }

  // Blob radius relative to the space — big enough that neighbors blend,
  // small enough to read as distinct patches.
  const blobRadius = spaceSize * 0.08
  const margin = blobRadius
  const innerSize = spaceSize - margin * 2

  const blobs = new Map<number, { cx: number; cy: number }>()
  const getBlob = (key: number): { cx: number; cy: number } => {
    let blob = blobs.get(key)
    if (!blob) {
      blob = {
        cx: margin + hash01(key + 1) * innerSize,
        cy: margin + hash01((key + 1) * 97) * innerSize,
      }
      blobs.set(key, blob)
    }
    return blob
  }

  for (let i = 0; i < total; i += 1) {
    const { cx, cy } = getBlob(bucketKey(i))
    const angle = hash01(i + 12345) * Math.PI * 2
    // sqrt for uniform disk sampling, so points don't pile up at the center.
    const dist = Math.sqrt(hash01(i + 67890)) * blobRadius
    out[i * 2] = cx + Math.cos(angle) * dist
    out[i * 2 + 1] = cy + Math.sin(angle) * dist
  }

  return out
}

/** Builds an n×n tile scatter by rigidly shifting each tile block. */
export function createTileScatterPositions (
  cols: number,
  rows: number,
  spaceSize: number,
  aspect: number,
  n: number
): Float32Array {
  const { left, top, w, h } = getPictureLayoutRect(spaceSize, aspect)
  const gridN = Math.max(2, Math.min(64, Math.floor(n)))
  const tileW = w / gridN
  const tileH = h / gridN

  // Deterministic scatter: each tile index maps to one stable X/Y offset.
  const scatterR = 0.72 * Math.min(tileW, tileH)

  const tileCount = gridN * gridN
  const offsets = new Float32Array(tileCount * 2)

  let pi = 0
  for (let cellJ = 0; cellJ < gridN; cellJ += 1) {
    for (let cellI = 0; cellI < gridN; cellI += 1) {
      const tileId = cellJ * gridN + cellI + 1
      const dx = hash01(tileId) * 2 - 1
      const dy = hash01(tileId * 31) * 2 - 1
      offsets[pi] = dx * scatterR
      offsets[pi + 1] = dy * scatterR
      pi += 2
    }
  }

  const out = new Float32Array(cols * rows * 2)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const offset = (row * cols + col) * 2
      const u = cols > 1 ? col / (cols - 1) : 0.5
      const v = rows > 1 ? row / (rows - 1) : 0.5
      const px = left + u * w
      const py = top + v * h

      const cellI = Math.min(gridN - 1, Math.floor((col * gridN) / cols))
      const cellJ = Math.min(gridN - 1, Math.floor((row * gridN) / rows))
      const ti = (cellJ * gridN + cellI) * 2

      out[offset] = px + (offsets[ti] ?? 0)
      out[offset + 1] = py + (offsets[ti + 1] ?? 0)
    }
  }

  return out
}
