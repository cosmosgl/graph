<!-- suggested path: history/2026/2026-09-15-point-stroke.md -->

# Per-point edge stroke in a shade of the point's own color

**Date:** 2026-09-15
**Commits:** `feat(points): per-point edge stroke in a shade of the point's own color` (<!-- TODO -->)

## Why

A thin outline in a slightly darker or lighter version of each node's fill is a common way to
separate overlapping nodes and lift them off the background without introducing a second
color. The existing outline feature (`outlinedPointIndices` / `outlinedPointRingColor`) is a
different thing: a selection ring in one uniform color drawn *outside* the point on a sprite
scaled up 1.3×. This adds a rendering-level stroke that every point gets, derived from its
own color, so it stays a single-color design and works with images, greyout, and highlighting
untouched.

## What changed

Three config keys, all in `GraphConfigInterface` / `defaultConfigValues`:

```ts
pointStrokeWidth: 0.5,        // CSS px; 0 (the default) disables the stroke
pointStrokeIntensity: 0.1,    // step in OKLab lightness (L, 0..1) from the fill color
pointStrokeMode: 'auto',      // 'auto' | 'darken' | 'lighten'
```

### Stroke color: a perceptual lightness step, per point

The first cut derived the stroke as a fixed-fraction `mix` toward black or white, with the
direction chosen from the background. That fails on bright saturated fills: a 15% mix toward
white moves a blue's channels by ~0.1 but a yellow's by ~0.01 (red and green are already near
1, only blue has headroom, and blue carries 7% of luminance), and Weber's law then discounts
the small absolute change on the bright fill further. Measured on the story: ~30% luminance
contrast on the blue cluster, ~5% on the yellow — one visibly outlined, one not.

The stroke color is now computed in **OKLab** (`src/modules/Shared/oklab-module.ts`, a luma
`ShaderModule` in the same style as `conicParametricCurveModule`, attached to both point
Models via `modules`):

- `pointStrokeIntensity` is a step in OKLab `L`. OKLab is perceptually uniform in `L`, so the
  same step reads as the same contrast on every hue.
- `'auto'` chooses the direction **per point** from the point's own lightness (threshold
  `L = 0.6`, roughly sRGB mid-grey): light points darken, dark points lighten, so the step
  always has room. `'darken'` / `'lighten'` force one direction for all points. The
  background no longer plays a role — the stroke is inset and its job is to separate a point
  from its neighbours, not from the canvas.
- Hue is preserved: after the shift the color is mapped back into sRGB by scaling chroma
  down (8-step bisection) only when it would leave the gamut, instead of clamping channels.
- It runs in the **vertex** shader on the greyed color and reaches the fragment as a
  `strokeColor` varying: one conversion per point rather than per covered pixel, and greyed
  points get a matching greyed stroke for free.

The module exports the sRGB ⇄ linear ⇄ OKLab conversions and the gamut mapping for any other
shader that wants to reason about color perceptually. The width is still converted to device
pixels on the CPU.

In `draw-points.frag` the stroke is a second coverage band read off the same signed distance
as the fill, so it anti-aliases exactly like the fill and costs nothing beyond a `mix`:

- **Pixel-space distance.** `shapeCoord` spans `[-1, 1]` over `shapeSize` device pixels, so
  `sd * shapeSize / 2` is the distance in pixels. Every shape function is a Euclidean SDF
  (unit gradient), which makes that conversion exact — the diamond was the one exception
  (an L1 form with gradient ≈ 1.3) and is now normalised, which does not move its edge.
  This is what makes a 0.5 px stroke *mean* 0.5 px at any point size and zoom level,
  including with `scalePointsOnZoom`.
- **Inset band.** The stroke occupies `d ∈ [-w, 0]`, so it never enlarges the point and the
  sprite needs no padding. The visual edge sits half a pixel inside the nominal boundary so
  the 1 px anti-alias band cannot cross the sprite bounds (which would flatten circles on the
  axes).
- **Small points are skipped.** A point whose diameter is below the stroke width is drawn
  without a stroke rather than as a solid blob of stroke color. Points just above that cut
  are still mostly stroke — the rule is a floor, not a fade.
- **Legacy edge when off.** With `pointStrokeWidth: 0` the original edge code runs unchanged
  (`smoothstep(0.9, 1.0, r²)` for circles, a ±0.01-unit band for other shapes), so existing
  renders are byte-identical. When the stroke is on, the fill's edge is also anti-aliased in
  pixel space — a constant 1 px band instead of one proportional to the point size — because
  a pixel-width stroke is invisible inside a size-proportional blur on large points.

Images composite above the stroke, as they already did above the fill.

## Example

`src/stories/points/stroke/index.ts` — Storybook *Examples/Points → Point Stroke*, starting at
width 0.75 px and a lightness step of 0.1 with `'auto'` shade. Two layouts, switchable in the panel:

- **Size grid** — a static 48 × 24 field of all eight shapes with sizes growing left to right
  from sub-pixel to ~28 px, in exact CSS pixels (`scalePointsOnZoom` off for this layout, so
  the ramp reads the same on any viewport). The left edge shows the "narrower than the
  stroke → no stroke" cut.
- **Overlapping clusters** — 2,400 circles of mixed size seeded in eight clumps and run with
  weak repulsion, a strong cluster force and strong gravity, so they settle into dense piles
  of one color each, held close together and framed at twice the default fit. This is the
  case the stroke exists for: without it a pile reads as one blob, with it the individual
  discs stay legible. `scalePointsOnZoom` is on here, so zooming in shows the stroke width
  holding steady while the discs grow.

Sliders for width and intensity, a shade-mode selector, and a light/dark background toggle
show `'auto'` flipping direction.

## Notes

- Not a breaking change; `migration-notes.md` untouched. The default width is `0`, so
  nothing changes for existing users.
- Unifying the fill anti-aliasing on the pixel-space edge for the stroke-off path too would
  simplify the shader, but it changes the look of every existing render (small points
  softer, large points crisper) and is left as a separate decision.
- Cost of the OKLab path: two `pow` gamma curves, three cube roots, four `mat3` multiplies
  and up to 8 gamut-mapping iterations per **point** per frame — negligible next to the
  per-fragment work, which is unchanged.
