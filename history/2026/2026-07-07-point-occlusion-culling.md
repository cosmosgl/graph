<!-- suggested path: history/2026/2026-07-07-point-occlusion-culling.md -->
# Depth-based point occlusion culling

**Date:** 2026-07-07
**Commits:** `Depth-based occlusion culling for overlapping opaque points` (`889dfa6`); rebase + follow-ups: `fix(points): adapt occlusion-culling core pass to current main` (`baaecda`), `refactor(points): simplify pointOcclusionCulling to a plain boolean` (`cbbcd9d`)
**PR:** [#238](https://github.com/cosmosgl/graph/pull/238)

## Why

A user-reported slowdown: rendering many points of a large size gets slow because the
cost scales with *covered* area, not *visible* area. Points usually overlap heavily in
dense graphs, but depth testing was disabled everywhere (`depthCompare: 'always'`,
`depthWriteEnabled: false`), so every point sprite's fragments ran the full fragment
shader **and** the alpha-blending read-modify-write even when completely hidden
underneath other opaque points. Most of that work produced pixels that were immediately
painted over.

## What changed

Point rendering now splits into two passes when points are effectively opaque — the
standard technique for opaque sprites in point-cloud/particle renderers:

1. **Opaque core pass, front-to-back.** A new `drawCoreCommand` model draws the same
   point geometry in *reversed* index order (topmost point first) with
   `depthCompare: 'less'`, `depthWriteEnabled: true`, and blending **off**. The fragment
   shader keeps only fully opaque fragments (final alpha ≥ `OPAQUE_ALPHA_THRESHOLD`,
   0.999) and discards the rest. Because nearer cores draw first, early-z rejects every
   fragment hidden behind them before it is shaded or blended — this is the speedup.
2. **Fringe pass, original back-to-front order.** The existing `drawCommand` with
   blending on, `depthCompare: 'less'`, no depth write. It discards the fully opaque
   fragments already drawn in pass 1 and renders the antialiased `smoothstep` edges plus
   any translucent points, blending correctly in stacking order. A point's own core
   fails `'less'` at equal depth, so nothing draws twice.

Depth encodes the pre-existing paint order — the vertex shader writes
`z_ndc = 1 − 2·(i + 0.5)/N` (higher point index = nearer = wins), so output is visually
identical to the standard path. The z write is unconditional and harmless when depth
testing is off. A 24-bit depth buffer resolves up to ~16.7M points.

The reversed draw order comes from a `Uint32Array` element index buffer `[N−1 … 0]`
(4 bytes/point, rebuilt only when the point count changes); attribute buffers, the GL
program, and the uniform buffers are all shared between the two models.

## Config

`pointOcclusionCulling: boolean`, default `true` — "enable the optimization; it applies
automatically when safe" (`pointOpacity` is `1` and `highlightedPointIndices` is not
set; highlighting always falls back, its layered greyed/highlighted rendering relies on
paint order). `false` always uses the standard single-pass rendering — the escape hatch
for driver/GPU trouble.

Per-point translucent colors are correct in every mode — fragments below the alpha
threshold simply render through the blended fringe pass, so mixed opaque/translucent
scenes need no special handling.

The option started as a tri-state (`undefined` = auto, `true` = force past the
`pointOpacity` check): force was redundant — auto already activates everywhere the
optimization can help, and with `pointOpacity < 1` the core pass can't produce any
fragments, so forcing was pure overhead. Simplified to the boolean before merge, as
proposed in PR #238's design note.

## Wiring notes (for future changes)

- `Points.draw()` picks the path per frame; pass-B parameters flip between
  `FRINGE_PASS_PARAMETERS` and `DEFAULT_DRAW_PARAMETERS` only on an actual mode change
  (same pattern as `Lines.updateLinkBlending`).
- **Every `drawCommand.setAttributes(...)` call site must mirror to
  `drawCoreCommand`** (`updatePositions`, `updateColor`, `updateSize`, `updateShape`,
  `updateImageIndices`, `updateImageSizes`). Attribute buffers are destroyed/recreated
  on point-count changes; a missed mirror leaves the core model's VAO pointing at dead
  buffers.
- The new UBO members (`pointsNumber` in the vertex block, `renderMode` in the fragment
  block) are **appended last** so existing std140 offsets are unchanged — keep that
  ordering if adding more.
- Hover/focus rings draw after both passes with `depthCompare: 'always'` and stay on
  top; links draw before points and never touch depth; picking/sampling FBOs use
  separate models with no depth attachments.
- **`drawCoreCommand` must stay configured identically to `drawCommand`** — same
  defines (incl. the `EXIT_DEFAULT_*` exit-ramp constants), same uniform buffers, same
  texture bindings (incl. `exitTexture`) — or the two passes stop sharing one cached GL
  program; a missing define is a shader compile error at runtime. The rebase onto
  current main tripped exactly this.

## Example

**Point Occlusion Culling** (`src/stories/misc/point-occlusion-culling.ts`,
*Examples/Misc*): 200k points of size 30 in 12 gaussian clusters (worst-case
overdraw) with `showFPSMonitor: true`, an On/Off culling toggle, and a toggle
that makes 30% of points translucent to demonstrate mixed-alpha correctness.

## Known characteristics

- On tile-based GPUs (Apple/ARM) the `discard` in the core pass weakens hidden-surface
  removal, so gains are smaller there; correctness holds everywhere by GL semantics.
- Fragments with alpha in `[0.999, 1)` are written unblended in pass 1 — a ≤0.1% color
  difference, imperceptible.
- Memory: +4 bytes/point for the reversed index buffer; each draw-uniform UBO grows by
  one f32.
