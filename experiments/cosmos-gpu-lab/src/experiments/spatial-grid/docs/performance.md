# Performance interpretation

The benchmark records six synchronized samples after one warm-up. Before each timer starts, the builder waits for earlier GPU work to finish. Each sample batches one or more full
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

[Neighborhood forces](#/neighborhood-forces) measures traversal using these cell ranges.
