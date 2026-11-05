# Outer-ring colors: automatic shades and per-point overrides

**Date:** 2026-11-05

## Why

[Issue #163](https://github.com/cosmosgl/graph/issues/163) asks for persistent rings
and individual ring colors. `outlinedPointIndices` already supplies persistent
rings, but its shared color cannot encode different states. Inset strokes support
individual colors, yet serve a different visual purpose from detached outer rings.
Fill-derived shades let rings keep the point's hue; explicit colors let them mark
states independently of that hue.

## What changed

`outlinedPointRingColor` keeps its white default and also accepts `auto`, `darken`,
and `lighten`, using the existing OKLab color utilities. Auto chooses the direction
from each point's fill lightness, as strokes do. `outlinedPointRingContrast`
controls the lightness step (default `0.1`). The shade is computed once per outlined
point in the vertex shader and follows animated fill colors.

`setPointRingColors(Float32Array)` supplies RGBA in 0..1, aligned to point indices.
An explicit color overrides the configured color or rule; any NaN channel falls
back for the entire point. A missing or mismatched array uses the configured
fallback everywhere. Colors alone do not enable rings: `outlinedPointIndices`
still controls visibility. Existing greyout dims the resolved ring RGB, after
shading from the original fill or resolving an explicit color. Ring alpha remains independent of body
opacity (`pointOpacity` / `pointGreyoutOpacity`), preserving selection marks even
when the body fades. Strokes retain their different rule: deriving from the
greyed fill and sharing the body's opacity.

```ts
graph.setConfigPartial({
  outlinedPointIndices: [0, 1],
  outlinedPointRingColor: 'auto',
  outlinedPointRingContrast: 0.1,
})
graph.setPointRingColors(new Float32Array([1, 0, 0, 1, NaN, NaN, NaN, NaN]))
graph.render() // first ring red; second derived from its point's fill
```

Ring-color updates apply immediately without a transition. The new channel has
one GPU buffer, rather than the source/target pair animated channels need. It costs
16 bytes per point only when a matching per-point array is supplied; config-only
colors carry no ring-color buffer or vertex attribute. Changing whether the
channel exists rebuilds the point draw models once, preserving an outgoing stroke
transition. Existing draw passes, ring geometry and the white default are retained.
This is additive; no migration is required.

## Example and validation

**Examples/Points → Outer Ring Colors** uses a seeded 720-point scatter in six
color groups. Placement accounts for both point bodies and outer rings, leaving
space between neighbors. Points and rings scale with zoom. The compact panel
exposes color rules, contrast, optional per-point colors with NaN fallback, a light
background and Fit view. Style changes preserve the camera; the source is in
Storybook's Source Code panel.

Browser tests cover fallback and explicit colors, automatic shading, allocation
and release, config rebuilds and interaction with stroke transitions. Software
rendering checks at 100,000, 500,000 and 1,000,000 points found white-ring median
changes between -2.3% and +2.7% against baseline
`93c3c9d77a64cac8f747a4be0c2683259f41e721`. Auto added 0.2–1.3% relative to white
rings; mixed overrides and NaN fallback added 5.3% at one million
points. These SwiftShader measurements include synchronized rendering and do not
establish native GPU performance. Benchmark scripts and generated images are
review materials kept outside the repository.
