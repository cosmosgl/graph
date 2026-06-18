# Spatial-hash collision force

**Date:** 2026-06-13
**Commits:** `6cb1b48`, `566bcba`, `6e41a8a`, `ad860ec`, `8284883`, `9c852f7`, `94dcfd3`

## Why

To make graph visualizations clearer. When point size carries meaning (degree, a
metric, importance), overlapping nodes become illegible — you can't see or click an
individual point. cosmos.gl had no force that resolves overlap: Link, Many-Body,
Gravity, Centering, and Cluster were all there, but Many-Body repulsion acts on point
*centers* and ignores radius, so it can't keep sized points apart. This adds the
missing piece — the same overlap-resolution `d3-force` provides via `forceCollide`,
which the cosmos.gl layout was modeled on.

## What changed

A new GPU force module, `src/modules/ForceCollision/`, that pushes overlapping points
apart. Rather than naive O(n²) pair checks, it builds a spatial-hash grid each tick and
resolves each point against its 3×3 cell neighborhood — staying in line with cosmos.gl's
"everything on the GPU, hundreds of thousands of points" goal.

Module layout:
- `index.ts` — the `ForceCollision` class (`CoreModule` subclass): resource allocation,
  program setup, and the per-tick `run()`.
- `build-grid.vert` / `build-grid.frag` — bins each point into a grid cell (point-list
  draw, additive blend); each cell accumulates `(sumX, sumY, sumSize, count)`.
- `force-collision-spatial.frag` — fullscreen pass that reads the grid and writes the
  per-point collision velocity.

## Config

Three properties (interface in `src/config.ts`, defaults in `src/variables.ts`,
`defaultConfigValues`):

| Property | Meaning | Default | Notes |
|---|---|---|---|
| `simulationCollision` | Force strength; `0` disables it (and skips all GPU work / allocation). | `0` | Story demos use ~0.2–1.0. |
| `simulationCollisionRadius` | Collision radius. `0` and `undefined` are aliases — both derive it per-point as `size * 0.5`; a positive value sets a fixed radius for all points. | `undefined` | Use a fixed value to decouple physics from visual size. |
| `simulationCollisionPadding` | Extra room added to every radius, so neighbors keep a `2 × padding` gap instead of just touching. | `0` | Composes with both derived and fixed radius. |

## How it runs each tick (GPU pipeline)

`run()` (`src/modules/ForceCollision/index.ts:256`) is two-phase, repeated over
`GRID_OFFSETS` — 4 half-cell offsets (`[0,0],[0.5,0],[0,0.5],[0.5,0.5]`) that catch
collisions straddling cell boundaries:

1. **Build:** for each offset, a point-list draw bins every point into one grid cell with
   **additive blending** (`blend: 'one'/'one'`), accumulating position-sum, size-sum, and
   count. Each offset writes its own grid framebuffer (4 separate FBOs allocated in
   `create()`).
2. **Resolve:** a single render pass into `points.velocityFbo` (cleared once), with the
   fullscreen force shader drawn 4 times — once per offset grid — accumulating additively.
   Each point reads the cell *averages* in its 3×3 neighborhood, computes a push-apart
   velocity from the overlap, and the integrator applies it via the usual
   `swapFbo → run → updatePosition` dance.

Grid sizing: `cellSize = max(effectiveRadius, 8)` and
`gridTextureSize = clamp(ceil(spaceSize / cellSize), 32, 512)`, then `cellSize` is
recomputed to divide `spaceSize` evenly. The 512 cap bounds grid memory regardless of
space size.

Shaders are **GLSL ES 3.0** (`#version 300 es`), imported with `?raw`, mirroring the
luma.gl `ForceManyBody` module. The build vertex shader samples the positions/size
textures (vertex-shader texture reads are required and supported here).

## Simulation integration (exact wiring)

All in `src/index.ts`:
- **Construction** — created alongside the other forces when `enableSimulation`.
- **Run + lazy init** — gated on `if (simulationCollision)`. On first use (or
  after invalidation) it calls `create()` + `initPrograms()` and sets `isForceCollisionReady`.
- **Ordering matters:** collision runs **after** gravity, many-body, links, and clusters
. Running it before the attraction forces let springs/clusters re-create overlap
  in the same tick, producing a standing oscillation. Keep it last.
- **Destroy**.
- **Invalidation** of `isForceCollisionReady` (forces a rebuild on next run):
  — on point-size / position / many-body data changes (`applyPendingChanges`).
  — in `updateStateFromConfig`: on `simulationCollisionRadius` /
    `simulationCollisionPadding` change, and — in derived-radius mode — on
    `pointDefaultSize` change (size texture + cell size depend on point sizes).

### Lazy allocation (zero-cost when off)

`isForceCollisionReady` (`src/index.ts`) is the whole state machine: GPU resources
(4 grid FBOs, size texture, compiled programs) are allocated **lazily on first run**, so a
graph that never sets `simulationCollision > 0` pays no memory or compile cost. Anything
that changes the inputs sets the flag `false`; the next collision tick rebuilds. If you
add a config/data path that affects collision sizing, add an invalidation there too.

## Stability & correctness details

- **Per-pass correction cap** — each pass clamps its output to ~10% of the point's
  collision radius (~40%/frame across 4 passes), so deep overlaps resolve by relaxation
  over several frames instead of overshooting and ping-ponging in dense regions.
- **Density damping** — force is scaled down when a point has many neighbors, further
  reducing jitter in dense clusters.
- **Border clamping** — the force pass clamps a point's own cell coords to the grid
  bounds, matching `build-grid.vert`. Without it, a point that drifts >1 cell outside the
  space sees an all-out-of-bounds neighborhood and loses collision response near edges
  (fixed in `8284883`).
- **Large-graph safety** — max point size is computed by **looping** over `data.pointSizes`,
  not `Math.max(...Array.from(...))`; spreading a 50K+ typed array as call args throws a
  `RangeError` before collision even initializes (fixed in `8284883`).

## Tuning guidance

- **Link distance must clear the collision radii.** If `simulationLinkDistance` is smaller
  than the combined radii of linked points, springs pull them inside each other and
  collision can't win — you get an unresolvable pile. The Collision demo uses
  `linkDistance: 50` for sizes up to ~30.
- **Jitter** is reduced by lower `simulationFriction` and shorter `simulationDecay` (less
  residual energy), and by the force ordering / correction cap above.
- **Density** = cost. More points per cell (smaller `spaceSize`, larger points) means more
  work per tick.

## Examples & docs

- **Collision** (`src/stories/forces/collision.ts`, *Examples/Forces*): a 6-cluster network
  of ~600 points, sized by degree and linked sparsely, that the collision force spreads into
  a readable layout. Seed positions are symmetric around the space center and the view is
  framed up front, so start-up isn't misread as drift. A new *Examples/Forces* group was
  introduced and the existing Clustering stories moved under it (*Examples/Forces/Clustering*).
- **Collision Stress Test** (`src/stories/forces/collision-stress-test.ts`, *Examples/Forces*,
  commit `9c852f7`): 50,000 points seeded with heavy overlap in a dense disc, repulsion off,
  gentle gravity to keep them packed so collision keeps working, `showFPSMonitor: true` to
  read the cost under load. Use this to gauge collision performance at scale.
- Docs: `simulationCollision` / `simulationCollisionRadius` / `simulationCollisionPadding`
  documented in the Configuration docs (ranges + defaults), Collision listed among the
  simulation forces, and the example linked from the README.

## Known limitations / future work

- **Centroid-based resolution.** A point reacts to the *average* of each neighboring cell,
  not to individual neighbors — cheap and scalable, but the source of residual jitter in
  dense areas. The bigger quality jump (if needed) is exact pairwise resolution: store point
  indices per cell and iterate real neighbors.
- The per-pass correction cap trades convergence speed for smoothness; raising it resolves
  faster but reintroduces overshoot.
