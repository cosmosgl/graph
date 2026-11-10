## Scope of this comparison

This experiment ports the **hierarchical global repulsion** used by Cosmos above 4,096 points. WebGL runs the production
aggregation, sample selection, far-field, near-field and integration GLSL through luma v10. WebGPU implements those operations
through luma kernels and draws resident positions. CPU provides an independent float32 model.

Both GPU backends build their own aggregates and sample lists. They receive the same CPU-computed data box, grid shift and
hash seed. This isolates the force port; the production GPU bounds reduction and automatic occupancy-driven sample budget
are **not** implemented or validated here. Sample count is explicit. Inputs are bounded to 16,384 points for this diagnostic;
forcing the grid path below the production cutoff is useful for small edge cases.

```flow
Shared frame · Positions, random directions, fitted bounds, shift and seed
Independent grid builds · Production blending / depth peeling, or WebGPU integer lists / gathers
Distant force · Sum centroid contributions outside each level's deferred shell
Near force · Weighted actual-point samples in the finest 3×3 neighborhood
Integrate · Preserve absent / pinned positions and apply the production displacement guard
Check · All cell aggregates, all selected identities, all present forces and all positions
```

Every tick starts from the CPU model's positions. These are same-input checks, not independent trajectory or convergence tests.

## How production divides the work

Grids have 8, 16, … cells per axis up to the production count-dependent finest size. Each cell stores position sums and
point count. Coarse levels use centroids outside a shell around the target. The next level refines the entire deferred
parent shell, then leaves its own smaller shell for the next level. Precise quality uses a 5×5 shell except at the finest
level; balanced quality uses 3×3 throughout. The finest level leaves a 3×3 neighborhood for actual-point interactions.

The grid follows the data. A shared reciprocal and power-of-two scales preserve parent–child cell relationships.
The shifted box changes each tick, so approximation boundaries do not stay on a fixed world line.

WebGL picks near neighbors with depth peeling: each pass selects the next eligible smallest hash in every cell.
The integer lowbias32 hash uses the point index and float32 seed bits. The stored float hash orders selection;
equal stored hashes are skipped after the first selected point, matching the production eligibility rule. Depth precision
and hash rounding can still cause cross-backend selection differences; identity checks expose them rather than hiding them
inside a looser force tolerance.

For a neighboring cell, the force is the sum of sampled pair forces multiplied by **other-point count / sampled-other count**.
The target is excluded from both counts. Small cells are exhausted exactly; dense cells are approximated. The final near
sum receives target-specific jitter and a fixed kick cap. The weighted estimate's unbiasedness assumes uniform sampling
before the nonlinear cap; it does not imply the final capped force or resulting layout is unbiased.

## WebGPU implementation choices

A point invocation uses integer atomic exchange to link itself into each containing cell. A later dispatch gathers each
list's positions and count. Another selects the smallest eligible hashes, then the force kernel traverses the same shells
and samples as production. Each target owns its force output; no float atomics or compute blending are required.

The [WGSL atomic rules](https://www.w3.org/TR/WGSL/#atomic-builtin-functions) guarantee atomic operations on each head, not
source-index ordering across invocations. The next links are only traversed after the linking dispatch completes.
The first implementation summed in atomic-list order and amplified dense-case force error. The current baseline sorts
up to 128 indices per cell, then adds in ascending source order. For larger cells it visits the sources in index order
and filters membership, avoiding quadratic insertion sorting. This makes summation deterministic; it does not make
GPU arithmetic bit-identical to the CPU model. Counts must match exactly; numeric checks keep the existing budget.
A second CPU calculation using each backend's actual structure helps separate construction from force evaluation.
The integration check uses that backend's own force readback. Neither diagnostic replaces the full CPU comparison.

This first builder favors inspectability. A cell with many points is traversed serially, and selecting K slots costs
K traversals; the dense aggregation fallback visits all sources for each crowded cell. It is **not a scalable million-point builder** and no timing advantage is claimed. Alternatives include
count/scan/scatter CSR, deterministic segmented reductions and parallel top-K selection. Those can reuse the lab's grid
primitives, but must preserve membership, selection semantics and acceptable summation error before replacing this baseline.

[NVIDIA's N-body discussion](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda)
describes the broader tradeoff between direct and hierarchical methods. Cosmos's grid-shell and sampled-neighbor model is
not a drop-in Barnes–Hut tree: changing the approximation requires its own quality comparison.

## Two exact references, two different questions

The UI evaluates up to 64 evenly spaced target indices against **every present source**:

- **Production exact radius split:** the existing exact solver separates near/far interactions by a fixed Euclidean radius.
  Comparing with it includes changes caused by the grid partition and which interactions receive the near cap.
- **Exact grid partition:** all pairs are still evaluated, but the finest 3×3 cell neighborhood defines near interactions.
  This holds the near/far split constant and better isolates centroid and neighbor-sampling error.

Both report relative L2 force error, `100 × sqrt(sum squared error / sum squared reference)`. These are measured errors,
not correctness gates. The subset cannot establish worst-case or whole-layout accuracy. Port validation checks every
present target separately against the same approximate model with the existing tolerance.

Production's grid force shaders do not define useful outputs for absent targets. Integration preserves those positions;
they must be excluded from every aggregate and sample. Force comparisons mask only absent targets. Present forces and
all output positions remain checked, including NaN sentinels for absent coordinates.
