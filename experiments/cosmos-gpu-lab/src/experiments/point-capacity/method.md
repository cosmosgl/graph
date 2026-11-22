A WebGPU buffer has a fixed size set at creation. The **active count** is how many points the graph uses.
The **capacity** is how many points its buffers can hold. [WebGPU buffer creation](https://gpuweb.github.io/gpuweb/#buffer-creation)

- **Rebuild** allocates new buffers sized for each count. **Reuse** allocates new buffers when the count exceeds
  capacity. When either path allocates new buffers, it copies the positions of the points that stay directly
  between GPU buffers and uploads any added positions. [WebGPU buffer copies](https://gpuweb.github.io/gpuweb/#commands-buffer-copies)
- **When the points fit**, reuse keeps the buffers and compiled GPU kernels. It repacks link data, adjusts the
  simulation grid, and writes any added points into both position buffers.
  Bounds, simulation, and drawing all use the active count.

Cosmos’s original WebGL engine uses the smallest square position textures that fit the point count and reuses
them when the dimensions stay the same. Going from 8,192 to 2,048 points changes the textures from
91 × 91 to 46 × 46 texels. WebGPU **Rebuild** also sizes storage to the current count. **Reuse** keeps the
larger allocation for later additions.

## What the charts measure

Both previews run the same chain graph with matching forces and drawing. The charts compare the final change
from 8,192 to 2,048 points in your run.

- **Time to remove points** starts after the test input is ready and covers the CPU work and wait for GPU completion.
  The next simulation frame runs afterward.
- **Buffer memory after removal** adds up the sizes of the buffers the demo tracks after the update, including
  positions, links, and scratch space.

**Reset / retry** starts both previews again with room for 2,048 points. On a rerun without a reset, the reuse
preview starts with the capacity it held at the end of the previous run.

## Recorded M3 check

On 11 November 2026, chain, communities and star graphs each ran three cycles on an Apple M3
with Chrome 156 and luma 10.0.0-alpha.4. All 36 paired resize checks and all 36 checks of the
following simulation step passed.

For the chain’s final change from **8,192 to 2,048 points**, reuse finished sooner and kept more
buffer memory. Each timing is the median of three removals.

| Approach | Time through GPU completion | Tracked buffer memory after removal |
| --- | ---: | ---: |
| Rebuild | 19.30 ms | 3.640 MiB |
| Reuse | 0.60 ms | 14.656 MiB |
