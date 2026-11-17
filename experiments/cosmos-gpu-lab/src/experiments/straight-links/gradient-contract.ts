import { expect } from 'vitest'
import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene, Settings } from './data'
import { gradientScene } from './gradient-fixtures'
import { compareColors } from './reference'

// Shared test contract, not renderer logic: exercise each backend independently.
export async function checkGradientContract<S extends Settings> (scene: Scene, defaults: S,
  render: (scene: Scene, settings: S) => Promise<RgbaSnapshot>): Promise<void> {
  const colors = gradientScene(scene, 'endpoints')
  const settings = { ...defaults, endpointColors: true }
  const solid = await render(colors, defaults)
  const gradient = await render(colors, settings)
  expect(compareColors(solid.color, gradient.color).changedPixels).toBeGreaterThan(0)
  expect(gradient.ids).toEqual(solid.ids)
  // RGB and alpha are separate channels: endpoint opacity cannot fade a link.
  const transparent = await render(gradientScene(scene, 'endpoint-alpha'), settings)
  expect(transparent.color).toEqual(gradient.color); expect(transparent.ids).toEqual(gradient.ids)
  const otherLinkRGB: Scene = { ...colors, links: colors.links.map(l => ({ ...l, color: [0, 1, 0, l.color[3]] })) }
  expect((await render(otherLinkRGB, settings)).color).toEqual(gradient.color)
  const fallback: [number, number, number, number] = [0.25, 0.6, 0.8, 0]
  const missing = gradientScene(scene, 'defaults')
  // Explicit values are independent of the candidate's default resolver.
  const explicit: Scene = {
    ...missing,
    points: missing.points.map((p, i) => ({
      ...p,
      color: i % 2 ? [0.1, 0.6, 0.9, 0] : [0.25, 0.2, 0.1, 0],
    })),
  }
  const defaulted = await render(missing, { ...settings, pointDefaultColor: fallback })
  const filled = await render(explicit, settings)
  expect(defaulted.color).toEqual(filled.color); expect(defaulted.ids).toEqual(filled.ids)
  const absent: Scene = { ...scene, points: scene.points.map(p => ({ ...p, color: undefined })) }
  const explicitDefault: Scene = { ...scene, points: scene.points.map(p => ({ ...p, color: fallback })) }
  expect((await render(absent, { ...settings, pointDefaultColor: fallback })).color)
    .toEqual((await render(explicitDefault, settings)).color)
  for (const blend of [true, false]) {
    const hidden = await render(colors, { ...settings, opacity: 0, blend })
    expect(hidden.ids.some(Boolean)).toBe(false); expect(hidden.color.some(Boolean)).toBe(false)
  }
  const restored = await render(colors, defaults)
  expect(restored.color).toEqual(solid.color); expect(restored.ids).toEqual(solid.ids)
}
