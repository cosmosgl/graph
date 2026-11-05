# Limitations and next questions

## Current limits

- The WebGPU reduction supports at most 65,536 points because it uses exactly two reduction levels.
- Every tick reads the result back to JavaScript.
- WebGL and WebGPU timings are collected sequentially in one page.
- The point renderer is intentionally minimal and does not represent Cosmos styling or picking.
- Only an unweighted center is implemented; every point contributes a mass of one.
- Device-loss recovery is not implemented.
- The saved result is an illustrative smoke run, not a cross-device benchmark.

## Migration questions exposed by the experiment

1. Should the production reduction use recursive dispatch, a fixed command graph or another primitive?
2. Can center results stay in GPU storage and feed later force passes directly?
3. Should reductions use plain `f32`, compensated summation or a hierarchical stability strategy?
4. How should the engine select workgroup sizes from device limits?
5. Which intermediate buffers can be reused by grid, scan and scatter stages?
6. How should failures and optional features be reported through the public Cosmos API?
7. How will deterministic tests define acceptable numerical divergence across vendors?

## Natural follow-up experiments

- Recursive reduction beyond 65,536 points.
- Exclusive scan primitive.
- Uniform-grid key generation and scatter.
- CSR adjacency construction.
- Many-body force using grid neighborhoods.
- WebGPU point rendering using simulation buffers without copies.
