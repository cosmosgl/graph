# Performance interpretation

The benchmark records six synchronized samples after one warm-up. Each sample batches several full
builds in a single command encoder and reports the normalized build duration. The batch size falls as
point count increases.

The measurement includes:

- clearing counts;
- point-to-cell counting;
- every hierarchical scan level;
- descending offset propagation;
- the offsets-to-cursors GPU copy;
- point-index scatter;
- command encoding, submission and queue completion.

It excludes position generation, buffer allocation, pipeline compilation, readback, CPU validation
and heatmap drawing.

## What to compare

Test the same point count against several grid sizes and distributions:

- Increasing grid size adds scan work and memory but usually reduces count/scatter contention.
- Clustered data can expose atomic hot spots hidden by uniform random points.
- Very coarse grids build cheaply but leave too many candidates for a later neighbour-force pass.
- Very fine grids cost more to build and traverse many empty cells.

The fastest builder is not automatically the fastest simulation. The useful choice minimizes the
combined cost of **grid construction plus neighbour traversal**.

## Next benchmark

The next experiment should consume this exact CSR representation for a nine-cell neighbour query.
That will reveal the crossover between grid resolution, build cost and force-evaluation cost.
