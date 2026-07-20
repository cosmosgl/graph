<!-- suggested path: history/2026/2026-07-08-many-body-repulsion.md -->

# Many-body repulsion: grid + Monte-Carlo near field

**Date:** 2026-07-08
**Commits:** `Precise Monte-Carlo near field force` (`3c78989`), `Add Repulsion Benchmark story` (`0c4d9d9`), `docs(force): explain grid-based many-body repulsion` (`7a612c6`); hardening: `fix(force): exclude absent points from near-field slots` (`24ed690`), `fix(force): replace sin-based hash with lowbias32 in near-field sampling` (`58ededd`), `fix(force): changing spaceSize disabled many-body and reused stale velocity` (`eeef329`), `refactor(force): drop dead grid-level branch and fix many-body comments` (`edba6b2`)

## Why

The 2D Many-Body (repulsion) force approximated the close range with a single cell
**center of mass**: at the deepest quadtree level each point was repelled from its own
cell's centroid, and nearby cells were covered coarsely by a `theta`-banded loop. A
centroid force is purely **radial**, so it can't spread a dense clump tangentially —
high-degree hubs collapsed into flat disks and petals, and close points never separated
naturally. This ports the P3M idea already used by the 3D force on the `feat/3d` branch
back to 2D: repel close points **individually** via an unbiased Monte-Carlo estimate of
the exact all-pairs sum, so dense regions spread instead of flattening.

## What changed

The theta-banded quadtree was replaced with a Barnes-Hut-style **grid pyramid** whose
finest neighborhood is closed by a **Monte-Carlo near field**. One code path handles every
graph size (an exact O(n²) brute-force path for small graphs was prototyped and dropped —
see Notes).

Shaders (`src/modules/ForceManyBody/`):

- `calculate-level.vert` + `calculate-level.frag` — aggregate each point into its grid cell
  (point-list draw, additive blend), accumulating `[sum(x), sum(y), count, 0]` per cell.
- `force-level.frag` — per-level centroid repulsion. Each level covers its aligned 6×6 child
  block minus the 3×3 Chebyshev-1 shell, so the pyramid tiles space **exactly once**.
- `build-nearfield-slots.vert` + `build-nearfield-slots.frag` — depth-peel a random K-subset
  of each finest-level cell (K = 8), re-drawn every tick; each slot stores `[point index, hash]`.
- `force-nearfield.frag` — the close-range pass over the 3×3 neighborhood (replaces the old
  `force-centermass.frag`, now deleted).
- `index.ts` — orchestrates per tick: aggregate levels → build slots → per-level force + near field.

## How it works

- **Grid pyramid:** grids of 4², 8², … up to an adaptive finest resolution (~`2·√n` cells per
  axis, floored at 8² and capped at 512²). One shared cell formula across all shaders.
- **Near field:** for the finest 3×3 neighborhood, each of the K depth-peeled points is a
  uniform random sample of its cell; weighting each sampled pairwise force by `count / sampled`
  (Horvitz–Thompson) makes the expected force equal the exact all-pairs sum — **unbiased, with
  no centroid term**, so the tangential component that spreads clumps survives.
- **Small/sparse graphs are effectively exact:** with ≤ 1 point per cell the near field samples
  each cell exhaustively and far cells' centroids coincide with their single point. The
  approximation only appears once cells hold more points than sampling slots.

## Stability fixes

Both live in `force-nearfield.frag`:

- **Coincident points** get a kick along a per-point random vector instead of a (undefined)
  inverse-distance force. Without it, exactly-stacked points never separate, and the stack's
  cell count repels everything around it into an empty "void" ring.
- **Per-tick velocity clamp** (`2 × cellSize`). The `count/sampled` weight is unbiased but
  high-variance; in a cell far more crowded than K it can turn a few close samples into a huge
  one-tick kick that flings points across the screen at startup and ejects dense-cluster
  centers. Clamping the magnitude keeps the direction while capping the fling; normal spreading
  kicks are well below the bound.

## Config

- No new options. The force honours `simulationRepulsion` exactly as before.
- `simulationRepulsionTheta` is now a **deprecated no-op** — it only tuned the removed
  approximation. Still accepted so existing configs don't break; ignored, and documented as such
  in the Configuration docs.

## Follow-ups

Fixes and cleanup after the first landing (all in `src/modules/ForceManyBody/`):

- **Cross-platform sampling hash** — the per-tick point hash moved from a `fract(sin(...))`
  one-liner to the integer **lowbias32** hash. `sin()` loses precision at large point indices
  and diverges across GPU vendors, correlating or colliding hashes and quietly biasing the
  depth-peel sample; integer ops are exact everywhere.
- **Absent points excluded from slots** — a removed point's NaN position could be peeled into a
  cell's sample and poison every neighbor's force. Slot building now skips absent points, matching
  the aggregation pass.
- **spaceSize changes** — changing `spaceSize` no longer disables the force or reuses stale
  velocity; allocation is point-count-based and each draw recomputes `cellSize` from the live
  space size.
- **Dead code + comments** — removed an unreachable grid-level recreation branch (a level's size
  is fixed by its index) and corrected stale comments, including the `simulationRepulsionTheta`
  JSDoc.

## Notes

- **Not a breaking change** — behavior settles differently (and more naturally) but the public
  API and config are backward compatible, so `migration-notes.md` was intentionally left alone.
- **Performance:** faster than the old path across the practical range (benchmarked ~1.2–4× per
  simulation step). The exact O(n²) brute-force path considered for graphs ≤ ~4k points was
  dropped: the grid is both faster (O(n²) does more work even at 2k points) and effectively exact
  when cells are sparse, so a second code path earned nothing.
- **Deep dive:** `docs/many-body-force/README.md` walks through the old vs new algorithm, the P3M
  decomposition, and the depth-peeling / Horvitz–Thompson math.

## Example

- **Repulsion Benchmark** (`src/stories/misc/repulsion-benchmark.ts`, Storybook *Misc*): times
  per-step GPU cost across point counts by stepping the simulation directly and forcing a
  readback, which bypasses the requestAnimationFrame cap that otherwise pins the FPS monitor at
  the display refresh. Use it to gauge repulsion performance at scale.
