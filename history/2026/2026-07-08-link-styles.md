# Link styles: dashed, dotted, and gradient links

**Date:** 2026-07-08
**Commits:** `11f185b`, `81548f1`, `d33ec60`

## Why

Links could only be drawn as solid, single-color strokes. Users need to encode link
semantics visually — dashed/dotted patterns to mark inferred, predicted, or otherwise
"soft" edges, and a color gradient along the link to show source→target flow. This adds
both, following the library's existing per-element conventions (mirrors the per-point
`PointShape` / `setPointShapes` design).

Purely additive: the default style is `LinkStyle.Solid` and gradient is off, so existing
graphs render exactly as before. No migration needed.

## What changed

Two orthogonal capabilities on links:

1. **Stroke pattern** — per-link Solid / Dashed / Dotted, set via `setLinkStyles`.
2. **Gradient** — a global mode that colors each link from its source point's color to its
   target point's color.

They compose: a link can be a dashed gradient, a dotted gradient, etc.

Touched files: `src/modules/GraphData/index.ts` (enum + data), `src/config.ts` +
`src/variables.ts` (config + defaults), `src/index.ts` (public API + wiring),
`src/modules/Points/index.ts` (endpoint-color texture), `src/modules/Lines/index.ts` and
`src/modules/Lines/draw-curve-line.{vert,frag}` (rendering).

## API

`LinkStyle` enum (`src/modules/GraphData/index.ts`), exported from the package root:

```ts
enum LinkStyle { Solid = 0, Dashed = 1, Dotted = 2 }
```

```ts
import { Graph, LinkStyle } from '@cosmos.gl/graph'

// One float per link; invalid values fall back to `linkDefaultStyle`.
graph.setLinkStyles(new Float32Array([LinkStyle.Solid, LinkStyle.Dashed, LinkStyle.Dotted]))
graph.getLinkStyles() // -> Float32Array

// Gradient is a global toggle (reads the colors set via setPointColors):
graph.setConfigPartial({ linkColorInterpolateFromEndpoints: true })
```

Styles are per-link, stored as a static instanced attribute (a `linkStyleBuffer`, wired
like `arrow` — no transition/animation, since a discrete enum shouldn't tween). `setLinks`
marks the style buffer stale so it is resized with the link count.

## Config

| Property | Meaning | Default |
|---|---|---|
| `linkDefaultStyle` | Fallback stroke pattern (`LinkStyle`, a number, or numeric string). | `LinkStyle.Solid` |
| `linkDashLength` | Dash length for dashed links. | `8` |
| `linkDashGap` | Gap between dashes, or between dots for dotted links. | `4` |
| `linkColorInterpolateFromEndpoints` | Interpolate each link's RGB from source→target point color. | `false` |

## Rendering notes

- The along-link parameter needed for both features was already available: `pos.x`
  (0→1 from source to target) is an existing fragment varying (the arrow code uses it).
  So dashes/dots needed no new geometry — just fragment logic plus a couple of varyings.
- **Gradient** reads point colors in the link vertex shader from a new `pointColorsTexture`
  in the Points module — an RGBA32F texture (`pointsTextureSize`) written in
  `updateColor()`, mirroring the existing `pointStatusTexture`. Point colors previously
  lived only as a per-point attribute the link shader couldn't reach. The fragment mixes
  the two endpoint colors by `pos.x` and overrides only RGB; opacity (visibility fade,
  greyout, hover) still comes from `rgbaColor.a`, so gradient composes with all of them.
- **Dash/dot masking** runs in the visible pass only (`renderMode < 0.5`), so gaps stay
  fully pickable in the index pass, and the arrowhead region is left solid. Dotted draws
  round dots sized to the stroke width. Anti-aliasing uses `fwidth()` so edges stay ~1px
  regardless of whether the pattern is in screen or world space.

## Zoom behavior

The dash/dot pattern follows `scaleLinksOnZoom` (consistent with how link *width* already
uses that flag):

| `scaleLinksOnZoom` | Pattern space | On zoom |
|---|---|---|
| `false` (default) | screen pixels | constant on-screen dash size, but the pattern shifts along the link as its on-screen length changes |
| `true` | graph (world) space | pattern is locked to the link and scales with zoom — no crawling |

Constant on-screen size and no-crawl are mutually exclusive (a fixed-pixel pattern on a
link whose screen length changes must change its dash count). The vertex shader picks the
space with a single `dashUnitScale` (`1.0` when scaling with zoom, else the zoom factor)
applied to both the along-link span and the dot diameter; the fragment logic is unchanged
between the two modes. On **curved** links the pattern is approximate (`pos.x` is the
non-arc-length curve parameter), which is fine on straight links — the common case.

## Examples

New **Examples/Link Styles** Storybook group (`src/stories/link-styles.stories.ts`):

- **Solid / Dashed / Dotted** (`link-styles/stroke-styles`) — the three patterns side by side.
- **Gradient Links** (`link-styles/gradient-links`) — endpoint-color gradient combined with
  each stroke pattern.
- **Interactive Playground (big graph)** (`link-styles/interactive`) — a ~5k-point / ~12k-link
  graph with a control panel to switch the stroke pattern and toggle gradient, curved links,
  arrows, and `scaleLinksOnZoom` (handy for seeing the zoom behavior above).

## Known limitations / future work

- Gradient endpoint colors come from the target point colors only, so during an animated
  point-color transition the gradient snaps to the final colors rather than tweening.
- Dash length/gap are global config, not per-link. Per-link dash metrics would need another
  channel if a use case appears.
