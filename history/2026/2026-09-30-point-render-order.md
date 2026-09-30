<!-- suggested path: history/2026/2026-09-30-point-render-order.md -->

# Point render order

**Commits:** <!-- TODO -->

## Why

Points were always drawn in index order, so a higher index was drawn on top, and there was
no other way to control what ends up on top. The only workaround was to reorder the input:
sort every per-point array, remap link endpoints, and keep a permutation map for callbacks
and index-based config. That also changes the simulation, because its random values
(per-point jitter, the per-tick near-field sample hash, per-link distance variation) are
dealt by index. And reordering at runtime meant calling `setPointPositions` again, which
zeroes velocities and re-uploads everything. `setPointRenderOrder` changes only the
drawing order: indices, the layout, and every other per-point array keep their meaning.

## API

`graph.setPointRenderOrder(order: ArrayLike<number> | null)` takes point indices from back
to front, applied on the next `render()`:

| Input | Result |
|---|---|
| a full permutation | drawn exactly in that order |
| some indices, e.g. `[7]` | the listed points go on top in list order, all others underneath in index order |
| an index listed twice | its last position wins, so appending an index brings it to the front |
| negative, fractional, `NaN`, ≥ point count | ignored (an out-of-range index comes back if the count grows) |
| `null`, `[]`, or anything that resolves to index order | index order, unindexed draw path |

Picking (hover, click) and label sampling (`getSampledPoints`) follow the order. While
`highlightedPointIndices` is set, highlighted points stay above greyed-out ones and the
order applies within each group. The order survives `setPointPositions` and is resolved
again against the new point count.

## What changed

- **Data:** `GraphData.updatePointRenderOrder()` resolves the input into
  `pointRenderOrder`, a full `Uint32Array` permutation, or `undefined` for index order.
  Like the link grouping, it rebuilds only when the input is reassigned or the point count
  changes (`render()` calls `update()` every time).
- **Buffers** (`Points.updateRenderOrder()`, a no-op unless the count or the resolved
  order changed):
  - `pointRenderOrderBuffer`, a uint32 element index buffer holding the order. It is bound
    to the point draw (standard, fringe and both highlight passes), the picking fill and
    the label-sampling fill, so each draws with `drawElements` in that order. It exists
    only while an order is set. Without one, `setIndexBuffer(null)` puts those models back
    on the old `drawArrays` path.
  - `reversedPointIndexBuffer`, the occlusion-culling core pass buffer, now holds the
    order reversed and is rewritten in place when the order changes. Before, it was
    rebuilt only on count changes, since its content was always `[N−1 … 0]`.
  - `renderRankBuffer`, a new per-point float vertex attribute holding each point's
    position in the order.
- **Depth:** `draw-points.vert` writes `z = 1 − 2·(rank + 0.5)/N` instead of using the
  point index. The occlusion core and fringe passes agree on what is on top only through
  depth. In an indexed draw `gl_VertexID` is the element value (the point index), not the
  draw position, so the rank has to come in as its own attribute. With no order the rank
  is the identity, so depth is unchanged.

## Verification

In-browser tests on Storybook's Vite server:
- **Top-point checks:** three stacked points, checking the pixel color, the picked index,
  the sampled index and `gl.getError()`. They cover every input shape above, culling on
  and off, highlighting, translucent blending, point count growing and shrinking, absent
  (NaN) points listed on top, calls queued before the device is ready, and an array edited
  in place and set again.
- **A/B against `main`:** a UMD build of the previous commit and of this branch, loaded
  into the same page, over a 20k-point scene with a full-frame pixel compare:
  - With no order set, every mode (culling on/off, translucent, highlighting) is
    pixel-identical.
  - With a random permutation, the output is pixel-identical to the old code drawing
    the input arrays physically permuted the same way.

## Notes

- **Cost of a scattered order:** an order that scatters neighboring indices makes the
  vertex stage's attribute reads and position-texture fetches incoherent. A coherent
  order is free. GPU timer queries at 1M points of 6 px on a vertex-bound 300×150
  canvas (Chrome, Apple M3 Max, medians, orders interleaved):

  | order | culling on | culling off |
  |---|---|---|
  | none | 3.42 ms | 4.48 ms |
  | reversed | 3.43 ms | 4.50 ms |
  | random permutation | 6.54 ms | 6.08 ms |

  `setPointRenderOrder` + `render()` for a new 1M-point permutation took 9–19 ms on the
  CPU (8 ms for a 1,000-index partial order); a `render()` with the order unchanged took
  about 3 ms.
- **Label sampling** still ignores highlight priority, as before: it follows the render
  order only.
- **`pointsTextureSize`** is no longer read by `draw-points.vert`. It stays in the
  uniform block so the std140 layout shared with `drawCoreCommand` doesn't change.

## Example

- **Render Order** (`src/stories/points/render-order/index.ts`, Storybook *Examples /
  Points*): four overlapping groups interleaved by index. Presets pass a partial order (one
  group on top) or a full permutation (small points on top, reversed index order), clicking
  a point brings it to the front, and the options check the order with occlusion culling,
  translucency and highlighting.
