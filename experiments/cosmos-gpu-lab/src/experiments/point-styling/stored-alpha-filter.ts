import { center, diameter, resolvePoint, WIDTH, HEIGHT, type Point, type Settings } from './data'
import type { PixelRegion } from './stored-alpha'

// A broad phase only: never predict visibility from alpha, shape or image texels.
// Both explicit renderers use a max(body, image, 1px) carrier capped by maxSize,
// padded by one device pixel per side. Retain an extra pixel plus a deliberately
// generous f32 error envelope for upload, transform and viewport arithmetic.
// Unbounded/non-finite inputs fall back to visiting the point, not rejecting it.
export function storedAlphaCandidates (points: Point[], settings: Settings, region: PixelRegion, order: number[]): number[] {
  return order.filter(id => {
    const p = resolvePoint(points[id], settings)
    const values = [p.x, p.y, p.size, p.imageSize ?? p.size, settings.zoom, settings.ratio, settings.sizeScale, settings.maxSize]
    if (!values.every(Number.isFinite) || settings.zoom < 0 || settings.ratio <= 0 || settings.sizeScale < 0 || settings.maxSize < 0) return true
    const [x, y] = center(p, settings)
    // Include a declared image even if the atlas later rejects its index. That
    // yields harmless extra candidates and does not couple the filter to loading.
    const image = p.image !== undefined ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
    const sprite = Math.min(Math.max(diameter(p, settings), image, 1), settings.maxSize * settings.ratio)
    const magnitude = (WIDTH + HEIGHT + Math.abs(p.x) + Math.abs(p.y)) * (1 + settings.zoom) * settings.ratio +
      (Math.abs(p.size) + Math.abs(p.imageSize ?? p.size) + settings.maxSize + 1) * (1 + settings.sizeScale) *
      (1 + settings.zoom) * settings.ratio
    // Do not try to cull enormous transforms whose cancellation/overflow is
    // outside this lab's bounded screen-space study.
    if (!Number.isFinite(magnitude) || magnitude > 2 ** 20) return true
    const radius = sprite * 0.5 + 2 + magnitude * 128 * 2 ** -23
    return x + radius >= region.x && x - radius <= region.x + region.width &&
      y + radius >= region.y && y - radius <= region.y + region.height
  })
}
