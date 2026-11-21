export type Pair = [number, number]
export type Camera = {
  viewport: Pair; origin: Pair; translation: Pair; zoom: number;
  ratio: number; sizeScale: number; maxSize: number; scaleOnZoom: boolean;
}
export type Point = { world: Pair; size: number; absent: number }
export type Query = { rect: [Pair, Pair] } | { polygon: Pair[] }

function centerInPolygon (x: number, y: number, topLeftPath: Pair[]): boolean {
  if (topLeftPath.length < 3) return false
  // The legacy shader uses the first 2048 edges, even for a longer path.
  // The Y comparison below preserves its half-open rule in top-left CSS coordinates.
  const crossings = topLeftPath.slice(0, 2048).filter(([ax, ay], index) => {
    const [bx, by] = topLeftPath[(index + 1) % topLeftPath.length]
    if ((ay < y) === (by < y)) return false
    const t = (y - ay) / (by - ay)
    return x < ax + t * (bx - ax)
  }).length
  return crossings % 2 === 1
}

export function selectedByReference (points: Point[], camera: Camera, query: Query): number[] {
  const [width, height] = camera.viewport
  const centerX = width / 2 * (1 + camera.translation[0])
  const centerY = height / 2 * (1 - camera.translation[1])
  const sizeZoom = camera.scaleOnZoom ? camera.zoom : Math.min(5, Math.max(1, camera.zoom / 100))
  const result: number[] = []
  for (const [index, { world, size, absent }] of points.entries()) {
    if (absent > 0.5) continue
    const x = centerX + (world[0] - camera.origin[0]) * camera.zoom
    const y = centerY - (world[1] - camera.origin[1]) * camera.zoom
    if ('polygon' in query) {
      if (centerInPolygon(x, y, query.polygon)) result.push(index)
      continue
    }
    if (size * camera.sizeScale <= 0) continue
    const radius = Math.max(1 / camera.ratio, Math.min(camera.maxSize, size * camera.sizeScale * sizeZoom)) / 2
    const [[left, top], [right, bottom]] = query.rect
    if (x + radius >= left && x - radius <= right && y + radius >= top && y - radius <= bottom) result.push(index)
  }
  return result
}

export function pointAt (camera: Camera, position: Pair, size: number, absent = 0): Point {
  const [width, height] = camera.viewport
  const x = (position[0] - width / 2 * (1 + camera.translation[0])) / camera.zoom
  const y = (height / 2 * (1 - camera.translation[1]) - position[1]) / camera.zoom
  return { world: [Math.fround(camera.origin[0] + x), Math.fround(camera.origin[1] + y)], size, absent }
}
