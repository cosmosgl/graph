import type { Snapshot } from './backend'
import { center, diameter, resolvePoint, type Point, type Settings } from './data'
import { imageFragment, compareColors, type ColorComparison } from './reference'
import { atlasInfo } from './atlas'
import { greyed, greyRgb, overlayIndices, pointOrder, ringColor, RING_SCALE, spriteDiameter } from './point-effects'

const ramp = (distance: number): number => {
  const t = Math.max(0, Math.min(1, distance + 0.5)); return 1 - t * t * (3 - 2 * t)
}
function over (foreground: number[], background: number[]): number[] {
  const alpha = foreground[3] + background[3] * (1 - foreground[3])
  return [...[0, 1, 2].map(c => alpha > 0
    ? (foreground[c] * foreground[3] + background[c] * background[3] * (1 - foreground[3])) / alpha
    : background[c]), alpha]
}
export function effectsCpuColors (snapshot: Snapshot, points: Point[], settings: Settings): ColorComparison {
  settings = { ...settings, atlasIsolation: snapshot.atlasIsolation, atlasPacking: snapshot.atlasPacking, atlasSource: snapshot.atlasSource }
  const count = settings.atlasSource?.images.length ?? atlasInfo(settings.atlasPacking).imageCount
  const { width, height } = snapshot; const color = new Uint8Array(width * height * 4)
  const hasImage = (p: Point): boolean => p.image !== undefined && p.image >= 0 && p.image < count
  const paint = (x: number, y: number, rgba: number[]): void => {
    const offset = (y * width + x) * 4; const alpha = Math.max(0, Math.min(1, rgba[3]))
    for (let c = 0; c < 3; c++) {
      color[offset + c] = Math.round(Math.max(0, Math.min(1,
        rgba[c] * alpha + color[offset + c] / 255 * (1 - alpha))) * 255)
    }
    color[offset + 3] = Math.round((alpha + color[offset + 3] / 255 * (1 - alpha)) * 255)
  }
  const pixels = (p: Point, radius: number, draw: (x: number, y: number, dx: number, dy: number) => void): void => {
    const [cx, cy] = center(p, settings)
    for (let y = Math.max(0, Math.ceil(cy - radius - 0.5)); y <= Math.min(height - 1, Math.floor(cy + radius - 0.5)); y++) {
      for (let x = Math.max(0, Math.ceil(cx - radius - 0.5)); x <= Math.min(width - 1, Math.floor(cx + radius - 0.5)); x++) {
        draw(x, y, x + 0.5 - cx, y + 0.5 - cy)
      }
    }
  }
  for (const id of pointOrder(points, settings)) {
    const p = resolvePoint(points[id], settings)
    const d = diameter(p, settings); const imageD = hasImage(p) ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
    const sprite = spriteDiameter(p, settings, imageD)
    const ring = p.outlined ? ringColor(p, settings) : [0, 0, 0, 0]
    pixels(p, sprite * 0.5, (x, y, dx, dy) => {
      const fragment = imageFragment(p, settings, x + 0.5, y + 0.5)
      if (!fragment) return
      let rgba = [...fragment.color, fragment.sourceAlpha]
      if (p.outlined) {
        const outer = Math.min(RING_SCALE * Math.max(d, 1, imageD), sprite - 1) * 0.5
        const inner = 0.9 * outer; const half = Math.max(outer - inner, 1) * 0.5
        const alpha = ramp(Math.abs(Math.hypot(dx, dy) - (outer + inner) * 0.5) - half) * ring[3]
        rgba = over([...ring.slice(0, 3), alpha], rgba)
      }
      paint(x, y, rgba)
    })
  }
  for (const overlay of overlayIndices(settings, points.length)) {
    const p = resolvePoint(points[overlay.index], settings); if (p.absent) continue
    const imageD = hasImage(p) ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
    const footprint = Math.max(diameter(p, settings), imageD); if (footprint <= 0) continue
    const outer = Math.max(footprint, 1) * RING_SCALE * 0.5; const inner = Math.sqrt(0.85) * outer
    let rgb = overlay.color.slice(0, 3); let alpha = overlay.color[3] * settings.opacity
    if (greyed(p, settings)) {
      if (settings.greyoutColor) { rgb = settings.greyoutColor.slice(0, 3); alpha = settings.greyoutColor[3] } else rgb = greyRgb(rgb, settings)
      if (settings.greyoutOpacity !== undefined) alpha *= settings.greyoutOpacity
    }
    pixels(p, outer + 1, (x, y, dx, dy) => {
      const coverage = ramp(Math.abs(Math.hypot(dx, dy) - (outer + inner) * 0.5) - Math.max(outer - inner, 1) * 0.5)
      paint(x, y, [...rgb, coverage * alpha])
    })
  }
  return compareColors(snapshot, { ...snapshot, color })
}
