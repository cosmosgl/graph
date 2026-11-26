# Spatial grid builder

The experiment turns an unordered position buffer into a **CSR-style spatial index** without moving
the working set back to JavaScript:

```text
positions → cell counts → exclusive offsets → grouped point indices
```

For every grid cell `c`, its points occupy one contiguous range:

```text
pointIndices[cellOffsets[c] .. cellOffsets[c + 1])
```

That representation is useful because a later force shader can inspect a point's own cell and its
eight neighbours without searching every point. The same structure can support collision,
approximate many-body forces, density maps, clustering and level-of-detail selection.

## Why this follows reduction

A reduction destroys structure while producing one answer. A grid builder preserves all points but
reorders their indices into useful groups. It combines several reusable WebGPU primitives:

- atomic counting;
- a hierarchical exclusive prefix sum;
- scatter through per-cell atomic cursors;
- GPU buffer copies between offsets and mutable cursors;
- one explicit synchronization boundary for validation.

The heatmap is drawn from the validated readback and is not part of the timed GPU build.

## Where the index is used

[Neighborhood forces](#/neighborhood-forces) visits nearby cell ranges to find candidate points.
The [resident many-body hierarchy](#/many-body-grid) uses the grouped indices to build its finest cells.
Both read the index directly on the GPU.
