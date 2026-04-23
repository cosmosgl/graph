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
