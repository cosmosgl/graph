# Snapshot → force → integrate → render

## Force rule

For point i and another point j, let delta = position[i] − position[j] and d = length(delta).
Self-interactions are excluded. Neighbors satisfy **d² < radius²**; the cutoff itself is excluded.

```text
pair force = strength × (1 − d / radius) × delta / d
total force[i] = sum of pair forces from all neighbors
```

At d ≤ 10⁻⁶, the pair contributes a deterministic X direction based on point indices:
−X when i < j, +X otherwise. This antisymmetric fallback prevents division by zero and separates
coincident points. It introduces a deliberate directional bias only near coincidence.
Each invocation writes only its own force and counts, so **force accumulation needs no atomics**.
Integer atomics remain in grid counting and scatter allocation.

## Tiled all-pairs baseline

A 128-invocation workgroup loads 128 positions into workgroup memory, then each active lane
evaluates that tile. A barrier separates loading from use, and another separates use from reuse.
Inactive lanes in the final workgroup still reach both barriers. Only their arithmetic and output
are skipped. The final tile also bounds its loop by the actual point count.

This is O(N²) arithmetic but shares position loads across a workgroup. It is a stronger baseline
than independently loading every neighbor from storage for every point. It is not claimed to be
the fastest possible all-pairs kernel on every GPU.

## Grid traversal

Reuse the existing hierarchical count/scan/scatter builder. Cell width h = 2 / gridSize in the
bounded domain [−1, 1]². Search **ceil(radius / h)** cells in each direction, clipping to valid
cell coordinates without wrapping. For each cell, traverse:

```text
pointIndices[cellOffsets[cell] .. cellOffsets[cell + 1])
```

The grid supplies candidates; the same exact distance test used by all-pairs determines neighbors.
Empty cells have empty ranges. Every point belongs to one cell, so traversal does not duplicate
neighbors. No fixed per-cell capacity truncates dense cells.

Building the index costs O(N + C) apart from the local scan's logarithmic factor, where C is the
number of cells. Neighbor work depends on candidate occupancy, not just N. Small radii and spread-out
points help; if most points occupy the searched cells, traversal can approach O(N²).

## Integration

The shared integration shader uses semi-implicit Euler with these illustrative stability limits:

```text
acceleration = total force, capped to magnitude 10
velocityNext = (velocity + acceleration × dt) × damping
velocityNext is capped to magnitude 0.5
positionNext = position + velocityNext × dt
```

Defaults: dt = 1/60, damping = 0.95 per tick, strength = 0.12. At a wall, position is clamped to
[−1, 1] and the offending velocity component is multiplied by −0.5. These are demo controls,
not a calibrated physical model or Cosmos production defaults.

## Ownership and ordering

Each method owns two position buffers and two velocity buffers. Grid construction and forces
read the active position buffer. Integration reads the old state and writes the other pair.
Rendering reads the new position buffer directly, then the CPU swaps only buffer indices.

The grid backend can now borrow the caller's device and position buffers. It owns and destroys
only its grid resources in this mode. Count and scatter bind groups are prebuilt for both position
buffers. The original spatial-grid demo still creates and owns its standalone device and positions.

Separate dispatches order grid stages and force evaluation; integration is a subsequent dispatch.
There is no attempt to synchronize all workgroups using `storageBarrier`. No point-state readback
occurs during playback. The view waits for queue completion to avoid accumulating work faster than
the GPU can consume it; this is backpressure, not a GPU-memory transfer.

Per method, state uses 32N bytes for two position/velocity pairs, plus 16N for force and counts,
16N for colors, uniforms, and—in the grid method—the spatial index. Validation adds temporary
readback buffers, which are released after mapping.

## Accumulation accuracy

The current grid kernel groups force contributions into blocks of 64 and groups of 16 blocks before
summing the totals. The all-pairs kernel sums its tiles in blocks of 64. A rare boundary path uses
explicit rounded addition for squared distance so fused arithmetic does not change exact cutoff counts.
See [Precision findings](#/neighborhood-forces/docs/precision) for the captured failures, unchanged
tolerances, regression tests and measured cost.
