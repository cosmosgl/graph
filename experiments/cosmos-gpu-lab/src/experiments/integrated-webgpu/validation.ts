import type { Integrated } from './runtime'
export function viewportProbes (width: number, height: number): [number, number][] {
  let seed = 1097
  const coordinate = (extent: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor(seed / 2 ** 32 * extent)
  }
  return Array.from({ length: 2048 }, () => [coordinate(width), coordinate(height)])
}
export async function validateFrame (runtime: Integrated): Promise<{
  finite: boolean; samples: number; boundarySamples: number; interiorIdFailures: number; interiorColorFailures: number;
  invisiblePicks: number; paintedSamples: number; visiblePoints: number;
}> {
  const points = (await runtime.backend.read()).positions
  const snapshot = await runtime.renderer.snapshot(); const { width, height, color, ids } = snapshot
  const styles = runtime.renderer.styles; const ratio = runtime.renderer.ratio
  const projected = Array.from({ length: points.length / 4 }, (_, i) => {
    const [x, y] = runtime.screen(points[i * 4], points[i * 4 + 1])
    const selected = runtime.renderer.selected === i
    return {
      x,
      y,
      radius: styles[i * 8 + 4] * ratio / 2 + (selected ? ratio : 0),
      color: selected ? [0.957, 0.847, 0.537, styles[i * 8 + 3]] : Array.from(styles.slice(i * 8, i * 8 + 4)),
      absent: points[i * 4 + 3] > 0.5,
    }
  })
  const result = {
    finite: Array.from(points).every(Number.isFinite),
    samples: 0,
    boundarySamples: 0,
    interiorIdFailures: 0,
    interiorColorFailures: 0,
    invisiblePicks: 0,
    paintedSamples: 0,
    visiblePoints: projected.filter(p => !p.absent && p.color[3] > 0 && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height).length,
  }
  const sites = viewportProbes(width, height)
  // Deliberately include point interiors and geometric edges, not just empty random pixels.
  for (const p of projected.slice(0, 128)) for (const dx of [0, p.radius, p.radius + 2]) sites.push([Math.floor(p.x + dx), Math.floor(p.y)])
  const blend = (dst: number[], src: number[]): void => {
    for (let c = 0; c < 3; c++) dst[c] = Math.round((src[c] * src[3] + dst[c] / 255 * (1 - src[3])) * 255)
    dst[3] = Math.round((src[3] + dst[3] / 255 * (1 - src[3])) * 255)
  }
  for (const [ix, iy] of sites) {
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue
    const x = ix + 0.5; const y = iy + 0.5; const expected = [0, 0, 0, 0]
    let expectedId = 0; let boundary = false
    for (let i = 0; i < runtime.data.graph.links.length; i += 2) {
      const a = projected[runtime.data.graph.links[i]]; const b = projected[runtime.data.graph.links[i + 1]]
      if (a.absent || b.absent || runtime.renderer.linkStyle.width <= 0 || runtime.renderer.linkStyle.color[3] <= 0) continue
      const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy); if (length < 0.00001) continue
      const along = ((x - a.x) * dx + (y - a.y) * dy) / length
      const across = Math.abs(((x - a.x) * -dy + (y - a.y) * dx) / length); const half = runtime.renderer.linkStyle.width * ratio / 2
      if (along >= -1 && along <= length + 1 && across <= half + 1 &&
        (Math.abs(across - half) <= 1 || Math.abs(along) <= 1 || Math.abs(along - length) <= 1)) boundary = true
      if (along >= 0 && along <= length && across <= half) blend(expected, runtime.renderer.linkStyle.color)
    }
    projected.forEach((p, i) => {
      if (p.absent || p.radius <= 0 || p.color[3] <= 0) return
      const distance = Math.hypot(x - p.x, y - p.y)
      if (Math.abs(distance - p.radius) <= 1) boundary = true
      if (distance <= p.radius) expectedId = i + 1
      const t = Math.max(0, Math.min(1, distance - p.radius + 0.5)); const coverage = 1 - t * t * (3 - 2 * t)
      if (coverage) blend(expected, [...p.color.slice(0, 3), p.color[3] * coverage])
    })
    const offset = (iy * width + ix) * 4; const id = ids[offset] + ids[offset + 1] * 256 + ids[offset + 2] * 65536
    result.samples++; if (color[offset + 3]) result.paintedSamples++
    if (id && !color[offset + 3]) result.invisiblePicks++
    if (boundary) result.boundarySamples++
    else {
      if (id !== expectedId) result.interiorIdFailures++
      if (expected.some((v, c) => Math.abs(v - color[offset + c]) > 2)) result.interiorColorFailures++
    }
  }
  return result
}
export function fit (runtime: Integrated, points: Float32Array): void {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) continue
    minX = Math.min(minX, points[i]); minY = Math.min(minY, points[i + 1]); maxX = Math.max(maxX, points[i]); maxY = Math.max(maxY, points[i + 1])
  }
  const c = runtime.renderer.camera; c.x = (minX + maxX) / 2; c.y = (minY + maxY) / 2
  c.zoom = Math.min(runtime.canvas.width / Math.max(1, maxX - minX), runtime.canvas.height / Math.max(1, maxY - minY)) / runtime.renderer.ratio * 0.8
}
