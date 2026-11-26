---
source: Recorded findings
recorded: 2026-11-19
device: Apple M3; Chrome 157; ANGLE Metal WebGL and non-fallback Apple Metal 3 WebGPU
scope: Same-count position, fill, size, and NaN enters and exits at fixed transition times.
---

# Point transition checks pass on M3

**WebGPU matched WebGL and the CPU reference at all 12 checkpoints.** All
finite positions, sizes, fill channels and exit fractions had zero measured
difference. IDs, absence, NaN sentinels and draw eligibility passed their
exact checks. An exiting point held its last position while the target was
already marked absent, and the color-only frame kept the completed exit gone.

At the interrupted update, the example point stayed at `(3, 7.75)` exactly.
Its size jumped from 9 to the previous target of 4 at the restart, and its
fill likewise returned to the previous target. Both GPUs reproduced this
production distinction between positions and visual channels. Those restarts
can show a style jump when updates interrupt one another.

The check used the production position fragment and read the size, exit and
fill rules before rasterization. The public Graph comparisons now exercise
removal and restoration with picking and selection, and changes to fill and
size during an animation. [Remove and restore a point](#/production-graph-api?section=try-sparse-transition) · [Change only point colors and sizes](#/production-graph-api?section=try-point-style-updates)

The focused test passed 2/2 on Apple M3, macOS 26.5.2, native Chrome
`157.0.8103.79` and luma `10.0.0-alpha.15`. WebGL reported ANGLE Metal on
Apple M3, and WebGPU reported Apple Metal 3 with `fallback: false`. The
validation capture and exact source archive are in
`captures/point-transition-m3-20261119-XShJCf/`, with source SHA-256
`182861c8afb69631972cdc9d3829729b10c669c3ea6014bf25b6e173ffac7477`.
The first attempt used `target`, a reserved WGSL word, and stopped before
the numerical checks. Its capture remains in
`captures/point-transition-m3-20261119-YSkByV/`.

The [transition protocol](#/point-shapes?section=doc-transition-method) gives the fixed times
and acceptance rules. The [archived transition test](https://github.com/cosmosgl/graph/blob/08e5ff5dd3ffdd4ca970a7bd96f22d7d3778a468/experiments/cosmos-gpu-lab/src/experiments/point-styling/transition.test.ts) contains the 12 checkpoints.
