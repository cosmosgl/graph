<!-- suggested path: history/2026/2026-10-06-deck-layers-curved-links.md -->

# Curved links in the deck layer

**Commits:** <!-- TODO -->

## Why

The engine has drawn curved links for a long time (`curvedLinks`), but `CosmosGraphLayer`
drew every link as a straight quad. The *Graph on a map* story wanted routes that arc like
flight paths, and travellers that fly along them.

## What changed

- **Four props on `CosmosGraphLayer`**, forwarded to its links sublayer: `curvedLinks`,
  `curvedLinkSegments`, `curvedLinkWeight` and `curvedLinkControlPointDistance`. They take the
  engine's names and defaults (`defaultConfigValues`).
- **The links sublayer draws the engine's curve.** It is a rational quadratic Bézier from source
  to target, with its control point on the chord's normal at `controlPointDistance` link
  lengths from the midpoint. The point at `t` is the average of source, control point and target,
  weighted `(1-t)²`, `2t(1-t)·w` and `t²`.
- **Geometry.** A link is now a triangle strip of `segments` quads with the curve evaluated in
  the vertex shader, and the extrusion's tangent comes from the neighbouring samples. A straight
  link is the one-segment case with the control point on the chord, so it renders exactly as
  before. A change in segment count rebuilds the model and re-sends the instanced attributes.

## Example

`integrations/deck-layers/src/stories/graph-on-map.ts`, Storybook *Examples / Integrations /
Graph on a map*. The routes between cities are curved links. Each route gets an invisible
pinned *waypoint* at its curve's control point, and a traveller on a trip is tied to home, the
waypoint and the destination. The story sets those three ties' strengths every frame, through
[`onSimulationDataLoaded`](2026-10-06-deck-layers-simulation-data.md), to the curve's own
weights at the traveller's progress. The resting point of that weighted pull is the curve point,
so the simulation flies the traveller along the drawn arc. The ties draw at width 0; only the
routes show.

Why not just curve the ties? A traveller held by two springs rests on the straight chord
between its cities, and its two ties, both sourced at the traveller, would bend opposite ways
around it in an S.

## Notes

- **Probe.** Measured headless with the story's clock slowed to match 60 fps, travellers in
  flight sat a median 4.4 layout units from their arc and 64 from the chord.
- **Frame rate.** The springs follow a moving rest point, so at low frame rates (SwiftShader
  manages about 6 steps per second) travellers trail behind it and cut inside the arc. At
  60 fps they ride it.
- **Repulsion and rest length** push a traveller a few units off the exact curve. The hidden
  waypoints are pinned points with size 0; they still repel travellers that pass near them,
  which is weak at the distance between a curve and its control point.
