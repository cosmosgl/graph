## The question

Can luma WebGPU reproduce **Cosmos's exact all-pairs repulsion**, including its stabilizers and position update?
This experiment compares the production GLSL shaders, a WGSL port and an independently written CPU reference.
It is the first stage of the global-force migration, before hierarchical approximation or composition with springs.

**Exact means every eligible pair is visited.** It does not mean exact real-number arithmetic, bitwise cross-device identity,
or an unmodified physical N-body law. Cosmos's near-field jitter and caps are part of the behavior.

## What runs

- **WebGL:** imports `ForceManyBody/force-allpairs.frag`, `Points/update-position.frag`, and the shared quad vertex shader
  directly from production source. Executes them through the lab's pinned luma v10 `Model` and `UniformStore`.
  This is a production-shader baseline, not a claim to run the complete production v9 Graph engine.
- **WebGPU:** luma `Kernel` runs either the ordered direct loop or a 64-invocation tiled loop, then a separate integration pass.
  `RenderKernel` draws directly from the resulting position buffer.
- **CPU:** scalar JavaScript with explicit `Math.fround` operations computes forces and integrates positions independently.
  It renders a Canvas 2D preview. It is not a benchmark competitor or an exact-arithmetic oracle.

The shaders see identical initial positions, parameters, absence/pinning flags and fixed random samples.
The lab generates samples deterministically with the production distribution (two independent draws in `[-1, 1)` scaled by `1e-5`).
It does not assume the full Graph engine uses the same PRNG sequence or upload order.

## One tick

```flow
Input positions · x, y, pinned, absent
All-pairs force · Visit source indices in ascending order; exclude self and absent sources
Near sum · Jitter, then cap | Far sum · Keep unbounded
Combine · Near + far correction
Integrate · Apply friction and production step guard; preserve pinned / absent points
Draw · Read current GPU positions directly
Validate · Read actual force and position outputs and compare with CPU
```

Pinned points still repel their neighbors and still receive a force calculation. Integration keeps their position fixed.
Absent points produce zero force and do not repel others. The edge fixture includes both a NaN absent position and an
explicitly absent finite position, to check that the flag controls participation.

## Force law

For target `i` and source `j`, let `d = position[i] - position[j]` and `q = dot(d, d)`.
For a coincident pair, substitute **the target's** random vector; if it is also zero, the contribution is zero.
Let `q' = sqrt(q)` when `q < 1`, otherwise `q' = q`. The contribution is:

```text
alpha × repulsion / sqrt(q') × normalize(d)
```

Thus the force magnitude varies as `1 / distance` beyond distance 1, and `1 / sqrt(distance)` below it.
Do not replace it with the inverse-square gravitational force from an N-body tutorial.
The original separation (before any coincidence substitution) selects the near/far bucket.

The strict near test is `distance² < nearLimit²`. Equality belongs to the far field.
The near sum is jittered componentwise (`near += near * random`), then its length is capped at `nearLimit`.
The far sum is added afterward. These operations cannot be rearranged without changing the force.

## Two distinct bounds

The lab uses production's grid-size helper:

```text
finestGridSize = clamp(nextPowerOfTwo(2 × sqrt(pointCount)), 8, 512)
nearLimit     = (2 × referenceLength) / finestGridSize
stepGuard     = referenceLength
```

The default `referenceLength` is 4096. The first bound splits near/far pairs and caps the near kick.
The second bounds an integrated substep; it does not clamp the point's world coordinates.
Friction is 0.85, repulsion is 1, and alpha is fixed at 0.6 for this controlled experiment.
There is no cooling schedule, gravity, center attraction, spring force or collision pass here.
A repulsion-only point cloud expands; it is not expected to settle into a graph layout.

## Read the two comparison modes differently

**Same input each tick** starts both GPUs from the CPU's current positions. The same-input comparisons isolate arithmetic
and implementation differences. Upload/readback are intentional validation overhead. This mode does not prove independent trajectory agreement.

**Independent trajectories** lets each backend keep evolving its own GPU state. At each tick, a CPU evaluation from
that backend's previous positions checks its one-step correctness. The table separately reports drift against the
independently evolving CPU path and between GPUs. Drift is diagnostic, not automatically a one-step failure or a quality pass.

All panels use the same camera, fitted to all available outputs, so different framing cannot hide divergence.
Blue points are free, orange points are pinned, and absent points are hidden. Minimal circle rasterization differs between
Canvas 2D, WebGL sprites and WebGPU quads; this page checks numerical simulation output, not pixel-perfect rendering parity.

## Scope

The UI stops at 4096 points, production's current exact-path threshold. Work grows as `N × (N − 1)` eligible candidates
before absence filtering. This experiment does not implement the production hierarchy, near-field sampling, live data updates,
or a full graph simulation. Native timing and the long-term quality envelope are separate follow-up work.
