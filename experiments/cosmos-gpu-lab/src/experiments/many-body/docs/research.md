## Preserve semantics before changing the algorithm

The first implementation follows the source-index order of production GLSL. Each target owns its force output,
so no floating-point atomic accumulation or compute blending is required. Keep the force and integration passes separate
so validation can inspect both actual outputs.

The code uses luma v10 APIs only: `Model` and `UniformStore` on WebGL; `Kernel`, `RenderKernel`, buffers and luma readback
on WebGPU. Production shaders are imported rather than copied. The force near bound uses production's shared grid-size helper.

## Direct gather versus shared-memory tiles

The direct WGSL entry point gives one invocation one target. It loops over all sources from GPU storage.
This is a straightforward baseline; it has no workgroup memory or barriers.

The tiled entry point gives each invocation the same target responsibility. A group cooperatively loads 64 source records
into workgroup memory. Each active target visits that tile in ascending order, and then the group loads the next tile.
This reuses source loads while retaining each target's accumulation order. It does **not** reduce quadratic arithmetic work.

[NVIDIA's N-body chapter](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda)
explains cooperative source tiling and its memory-reuse motivation. We adopt that organization, not its gravitational
force formula, historical hardware tuning or performance claims. Whether tiling helps this Cosmos workload still needs matched measurements.

```flow
Load · One source record per invocation into a 64-record tile
Barrier · Finish writes before any target reads the tile
Accumulate · Active targets visit sources in their original order
Barrier · Finish reads before the next tile overwrites shared memory
Repeat · Continue until all source indices have been visited
```

Tail invocations and absent targets still participate in both barriers. The final tile guards source loads beyond the
point count and visits only valid slots. Early return before these barriers would violate uniform control flow.
The [WGSL specification](https://www.w3.org/TR/WGSL/#sync-builtin-functions) defines workgroup synchronization and uniformity requirements.

The fixed group size of 64 is a conservative first configuration, not a result of tuning. We should compare sizes only
after correctness and a reliable timing harness are established.

## Alternatives considered

| Approach | Why it is not the initial compatibility baseline |
| --- | --- |
| One invocation per pair, scatter to both targets | Requires accumulation coordination and changes addition order; per-target coincidence jitter also breaks simple pair symmetry |
| Parallel reduction of a target's source contributions | May improve long target loops, but changes the floating-point reduction tree; evaluate error before adopting |
| Algebraically combine normalize and distance divisions | Can change rounding and boundary behavior; keep production operations for the initial port |
| Subgroups | Optional capability and implementation-dependent width; not needed for the first portable kernel |
| Hierarchical grid / Barnes–Hut / multipole methods | Change which interactions are approximated; belong to the next experiment, measured against this exact reference |

The [WebGPU specification](https://www.w3.org/TR/webgpu/) separates resources, pipelines and execution.
This design keeps positions resident between compute and render, while the validation UI deliberately reads them back.
It makes no assumption that the newer luma experimental graph-layout models have the same Cosmos semantics or are exported by our pinned alpha.

## Precision and reproducibility

Both kernels retain separate near and far sums. The CPU reference rounds scalar operations to float32, but GPUs can
still differ through contraction, normalization and square-root implementations. All eligible pairs being visited
is a structural property; bitwise agreement across backends is not guaranteed.

Coincident stacks are sensitive: the first kick spreads points in sample-dependent directions, and small rounding
differences can affect subsequent close interactions. Test a force on identical positions before attributing independent
trajectory drift to an incorrect port. Report both; do not silently increase the one-step tolerance to hide drift.

The current absence test checks that NaN sentinels are preserved by load/store for explicitly absent points and never used
in force arithmetic. This is observed backend behavior, not a promise that arbitrary NaN arithmetic is portable in WGSL.
The [WGSL floating-point rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation) should guide a future production data representation.
