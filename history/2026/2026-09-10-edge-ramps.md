<!-- suggested path: history/2026/2026-09-10-edge-ramps.md -->
# Edge ramps: one device pixel, centred on the edge

**Date:** 2026-09-10
**Commits:** `fix(points): close the triangle field's segment at the apex — the ramp holds on every edge` (`48f887f`), `fix(points): clamp the pentagon field to the true half side` (`16a66da`), `fix(points): composite the outline ring over a transparent body` (`7a6d9c7`), `perf(points, links): centre a one-device-pixel edge ramp on every edge` (`ad201be`), `refactor(points): one size rule for draw, ring, picking and selection` (`d855646`), `fix(points): pad the selection rectangle in CSS px — the footprint is the drawn point` (`1df6d42`), `feat(stories): edge anti-aliasing check at 0.5×, 1×, 2×, in a Rendering section` (`94a8e2b`)
**PR:** [#262](https://github.com/cosmosgl/graph/pull/262)

## Why

Every edge ramp in the point, link and ring shaders was a fraction of its shape: the last 5% of
a circle's radius, half a CSS pixel for a link, 2.5% and 5% of a ring's radius. Tuned when the
canvas was always 2× and the browser's downsample supplied the anti-aliasing. `pixelRatio`
follows the display since v3, so a 1× monitor gets the shader's ramps alone.

```text
  Big point (~20 px)                 Small point (~4 px)
  ████████░░░░                       ██░
  ██████████░░  ramp ~1 px           ███  ramp ~0.1 px → hard edge
  ████████░░░░                       ██░
```

A 4 px point has no ramp at all. A 1 px link's is half a pixel, and a shallow link shows a
ladder that crawls as it moves.

The obvious fix, one device pixel of ramp placed inside the edge, was measured and set aside.
It removes the ladder, but a fade inside the edge is a hard edge moved inward by half a ramp.
A 1 px link keeps 38% of its ink and peaks at alpha 0.49, a 4 px point keeps 62%, and the
hover and outline rings, which multiply one ramp per edge, vanish on any point under about
30 px.

## What changed

One constant, `EDGE_RAMP_PX = 1.0` in `variables.ts`, reaches the point, link and highlight
programs as a `#define`, the way the exit defaults do. Every edge gets a ramp that wide,
centred on the edge.

```text
  coverage
  1 |███████░░
    |         ●        0.5 exactly on the geometric edge
  0 |__________░░___   half the ramp inside, half outside
```

A centred fade integrates to the same area as a hard edge, so a shape keeps its ink at every
size and pixel ratio, and its rendered size matches what a legend draws with SVG or CSS. Half
the fade is outside the shape, so the primitive either grows by one ramp or clips the outer
half. Links and rings grow; a point's sprite does not (see the frame times below).

```text
  link quad                              point sprite
  |← — — — — — — — — — — — →|           ┌──────────┐
  | ½ ramp | true shape | ½ ramp |       │ ·´    `· │  the disc touches the sides:
                                         │:        :│  the outer half of the fade is
                                         │ `·    ·´ │  clipped there, whole on the diagonals
                                         └──────────┘
```

- **Links.** The quad is `max(width, ramp) + ramp` wide and the fragment fades over the outer
  ramp width, so the ramp straddles the stroke's edge. An arrowed link's body and head edges
  are fractions of the arrow width, so they are rescaled to the padded quad before their
  ramps are centred on them. Dash caps and dot edges fade over the same ramp; dots are sized
  to the stroke, not the padded quad. A new `pixelRatio` uniform converts the ramp to space
  units.
- **Points.** The sprite is the shape's own size, so the fade's outer half is clipped where
  the shape meets the sprite's sides — a circle at its four axis points, whole on the
  diagonals. A padded sprite was built and measured (below): it keeps every pixel of ink but
  costs 12–45% of the frame on million-point scenes, against 0–14% without the padding, for
  92% of a 4 px circle's ink and 78% of a 2 px one's. The shape's cap is the hardware limit
  itself: a capped point clips the fade's outer half like any other, so the ramp of room the
  padded design reserved under the limit is gone with it. An outlined sprite still pads for
  its ring. The circle's ramp runs along
  the radius rather than in r², which skews coverage outward on a small disc: a length and a
  smoothstep. The other shapes size their ramp from their distance field's gradient per pixel,
  so a diamond gets the same fade as a square; the field and its derivatives are evaluated in
  the polygon branch only. Every fragment of a sprite shares `pointShape`, so the branch is
  coherent and the derivatives are defined; evaluating them for every shape, on the theory
  that derivatives want uniform control flow, cost the circle a field, two derivatives and a
  square root per fragment it never read — a tenth of the points pass (below).
- **One size rule.** The size in device pixels — pixel ratio, zoom, the hardware cap — is
  one GLSL function (`point-size.glsl`, a luma shader module) shared by
  the draw, ring, picking and rectangle-selection programs, and `spaceToScreenRadius` mirrors
  it on the CPU with the same cap and the 1 px floor. What is drawn, hovered, selected and
  measured is one size; the copies that used to be kept in step by comment are gone. Making
  the unit explicit showed rectangle selection padding its CSS-px rectangle by a device-px
  size, a footprint twice the drawn point on a 2× display since before this work; it now
  converts, and the footprint is the drawn point at every pixel ratio (its own commit: a
  behaviour change, not part of the refactor).
- **Shape fields.** Two fields were not the distances they claimed, found while checking the
  ramp on every shape. The triangle clamped its edge segment to −1.0 where the construction
  needs −2r = −1.8 (Quilez's `sdEquilateralTriangle`), so the field jumped ±0.35–0.8 across
  the apex-side 44% of each slanted edge and those edges got no ramp at all, on `main` too.
  The pentagon clamped to `k.z·k.x` = 0.588 where its corners fold to ±r·tan 36° = 0.528:
  wrong outside the corners only, contour unchanged. Both now match the exact Euclidean
  distance to their polygon to four decimals, |∇d| = 1 off the folds, so the ramp holds on
  every edge of every shape.
- **Rings.** Both rings become a band on the ring's centre line with the ramp on each edge.
  The outline sprite and the focus quad pad a full ramp per side, not the link quad's half:
  a ring thinner than the ramp is widened to a one-ramp core centred on its band, whose outer
  fade reaches up to a full ramp past the geometric edge (exactly `1 − band/2`); the focus
  ring gains a `pixelRatio` uniform. When the hardware cap clamps an outlined sprite, the ring
  tightens onto the body instead of leaving the sprite, pulled in by half a ramp: a ring that
  large is never widened, so its fade ends half a ramp past its edge, on the sprite's. Both
  rings are sized from the drawn core, so a point under a pixel carries the 1 px point's ring
  rather than one shrinking into its own body; at that size a ring is a dot in its colour
  either way, since its band is never thinner than the ramp.

Unblended links (`linkBlending: false`) cannot carry a fade in alpha, so the fragment keeps
the pixels whose centre is inside the stroke, coverage 0.5 being the geometric edge, and the
vertex stage floors them at one device pixel instead of the ramp. Hard edges at the true
width; a link under a pixel is a one-pixel line.

Thinner than the ramp, each element keeps the property that matters for it:

| element | rule |
|---|---|
| link | drawn at ramp width, `alpha = width / ramp` (ink preserved; a 1 px link on 1× is exactly one ramp wide and untouched, a 0.5 px link peaks at 0.5) |
| arrowed link | the rule is applied to the head width, which is what the quad holds; a body under the ramp inside a head that is not keeps its own geometry, brighter and thinner than a plain link of the same width (a 0.5 px body on 1× peaks at 0.84 over ~1.5 px; ink 0.53, not lost) while the head draws as is. Accepted: flooring the body would widen or dim the head, the part of an arrowed link one looks at |
| ring | drawn at ramp width, alpha stays 1 (visibility preserved) |
| point under 1 px | 1 px core, `alpha = shape² / core²` (ink preserved; the GPU rasterises no smaller sprite, and a full-alpha pixel deposited up to five times the point's area) |
| unblended dot | diameter at least √2 device px, so a dot always holds a pixel centre and the hard cut cannot erase it |
| size 0, width 0 | nothing: the sprite, the focus ring's quad and the link quad are culled in the vertex stage, before the floor or the ramp can widen an absent element; `spaceToScreenRadius` returns 0 and picking and rectangle selection skip the point, so the CPU, hover and selection agree with the draw |

1.0 is the box filter: a straight edge deposits in each pixel exactly the area it covers.
A wider ramp reads softer on a 1× display and costs sprite area; 1.3 was tried and measured,
about a tenth more frame time on small points for the softer edge, and 1.0 stayed.

The second commit fixes the outline ring's compositing. `mix(body, ring, alpha)` with alpha
`max(body, ring)` tinted a partially covered ring pixel with the point's colour outside the
body and, after the blend, applied the ring's alpha twice; a 20 px point's ring put 9 px² of
ink on screen where its coverage said 25. The composite is now source-over with the body's
alpha as its weight.

## Measured

Ink is coverage summed over pixels against the nominal area or width, at pixel ratio 1 on an
M3, Chrome on Metal:

| element | before | now | padded sprite |
|---|---|---|---|
| 1 px link, ink / peak alpha | 0.74–1.00 / 1.00, by sub-pixel position | 0.96–1.00 / 1.00 | — |
| 0.5 px link, ink | 0.24–1.00 | 0.96–1.00 | — |
| 2 px point, ink | 0.95 | 0.78 | 1.00 |
| 4 px point, ink | 0.95 | 0.92 | 1.00 |
| 8 px point, ink | 0.95 | 0.97 | 1.00 |
| 20 px point, ink | 0.95 | 0.99 | 1.00 |
| outline ring on a 4 px point | 0.18 px wide | 1.0 px wide, full alpha | same |

Frame time, milliseconds per frame: the same frame drawn ten times back to back with a GPU
drain (`renderFrame` ×10, `finish` + `readPixels`), median of seven, best of two interleaved
rounds; M3 via ANGLE Metal, 800×600 CSS px canvas at the scene's pixel ratio, simulation off,
everything fitted on screen, the four states interleaved in one run. `main` → padded sprite →
the shape's own sprite with the field and its gradient evaluated for every shape → this
branch:

| scene | main | padded sprite | field on every shape | now |
|---|---|---|---|---|
| 1M points, 4 css @2× = 8 device px | 28.7 | 32.2 (1.12×) | 29.5 (1.03×) | 29.0 (1.01×) |
| 1M points, 4 css @1× = 4 device px | 14.7 | 21.2 (1.45×) | 18.4 (1.26×) | 16.7 (1.14×) |
| 1M points, 2 css @2× = 4 device px | 23.4 | 34.0 (1.45×) | 26.6 (1.14×) | 25.0 (1.07×) |
| 1M points, 0.8 css @2× = 1.6 device px | 21.0 | 28.4 (1.35×) | 22.0 (1.05×) | 21.4 (1.02×) |
| 1M points, 0.4 css @2× = 0.8 device px | 20.3 | 24.2 (1.19×) | 20.8 (1.02×) | 20.4 (1.00×) |
| 100k points, 32 css @2× = 64 device px | 11.9 | 13.1 (1.10×) | 12.8 (1.08×) | 12.1 (1.01×) |
| 1M points, square, 8 device px | 28.8 | 33.0 (1.15×) | 30.2 (1.05×) | 30.3 (1.05×) |
| 1M points, 8 device px, occlusion culling off | 39.4 | 51.1 (1.30×) | 44.3 (1.13×) | 39.4 (1.00×) |
| 50k points / 500k links, 1 css @2× | 19.1 | 19.4 (1.01×) | 19.3 (1.01×) | 19.3 (1.01×) |
| 50k / 500k links, 1 css @1× | 10.1 | 11.3 (1.13×) | 11.1 (1.11×) | 10.8 (1.08×) |
| 50k / 500k links, 0.25 css @2× | 16.2 | 17.9 (1.10×) | 17.9 (1.11×) | 17.6 (1.09×) |
| 50k / 500k links, 1 css @2×, unblended | 11.6 | 11.7 (1.01×) | 11.5 (0.99×) | 11.5 (1.00×) |
| 50k / 500k links, 3 css @2× | 25.9 | 26.2 (1.01×) | 25.9 (1.00×) | 25.9 (1.00×) |

Two costs, one per column. The padding is rasterization: a sprite of s device px rasterises
≈ s² fragments per pass and both occlusion passes shade it; padding it by one ramp is
(s+1)²/s², which is what the second column pays on small points, and on a small point the
opaque core is a fraction of a pixel, so the core pass shades the sprite and discards it. The
field on every shape is the shader: the single-pass row has no core to hide behind and shows
it whole, 13% of the points pass, gone once the circle stops evaluating a field it never
reads; the 64 px row says the same. What remains at 4 device px is the ramp itself. The
opaque core, the fragments the depth-writing pass keeps, is `r < R − ½`: 56% of a 4 px disc
against 90% for `main`'s 5%-of-radius ramp, and the rest goes through the blended pass under
thirty-fold overdraw. Narrower is no anti-aliasing. Links keep their padded quad
(`max(width, ramp) + ramp`): their cost is dominated by the vertex work and shows as 0–9%,
the 1× and sub-pixel rows, where the quad widens, being the two that move.

Set aside: skipping the core pass for points under ~10 device px, which halves the padded
sprite's cost with identical output, is unneeded once the sprite is the shape; an inside ramp
with no padding costs the same as this and keeps only 62% of a 4 px point's ink and 50% of a
2 px point's; a hard-edge opt-in mode stays the honest escape hatch for million-point clouds
if these numbers are still too high.

## Example

`src/stories/rendering/anti-aliasing/` — Storybook *Examples → Rendering → "Edge Anti-aliasing
at 0.5×, 1×, 2×"*. One scene in three panes at pixel ratio 0.5, 1 and 2 with a shared camera:
every shape plain and outlined at 0.5–16 px, and a ring of links 0.25–8 px wide at every
angle; scrolling sweeps every size through the ramp on all three. SVG reference rings mark
each circle's exact nominal diameter, so the rendered size can be read against what a legend
would draw. Toggles for `linkBlending`, arrows, curved links, scale on zoom and the link
style. The same story run against `main` shows the stair-steps and dropouts this entry
describes.

## Notes

- Sprites under one pixel are rasterised at one pixel with `gl_PointCoord` spanning it, so
  the old shaders drew a sub-pixel point at a full pixel; the one-pixel core with area alpha
  is the same footprint at the right ink. A zero `gl_PointSize` is not culled either: the
  spec leaves it undefined and this platform draws a full pixel, hence the explicit cull.
- Each treatment was checked against a per-pixel model of it on plain WebGL 2; the GPU
  stays within 0.03 of the model except for the old rings, whose ramps are thinner than the
  GPU's sub-pixel precision.
