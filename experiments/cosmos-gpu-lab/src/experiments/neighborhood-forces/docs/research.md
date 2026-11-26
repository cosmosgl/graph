# Research and implementation choices

Sources reviewed for this experiment on 9 November 2026. CUDA material informs algorithms;
the WGSL and WebGPU specifications define the actual synchronization contract used here.

## Timestamp measurements

The [WebGPU timestamp-query specification](https://www.w3.org/TR/webgpu/#timestamp-query) defines
pass-boundary queries and nanosecond results, requires reduced precision, and permits occasional
negative deltas when counters reset. We preserve exact integer endpoints, reject invalid differences,
and expose unsupported queries explicitly. The
[compute-boids sample source](https://github.com/webgpu/webgpu-samples/blob/main/sample/computeBoids/main.ts)
also demonstrates optional feature requests, pass timestamp writes, query resolution and mapped readback.
Our offline benchmark serializes readback outside each measurement instead of using a live-frame pool.

## Stable input snapshots

The [WebGPU compute-boids sample](https://github.com/webgpu/webgpu-samples/tree/main/sample/computeBoids)
demonstrates alternating particle buffers for simulation and rendering. We adopt separate input/output
state but keep force and integration in separate dispatches so they can be inspected and timed independently.

## Dispatch boundaries, not a global shader barrier

[WGSL synchronization built-ins](https://www.w3.org/TR/WGSL/#sync-builtin-functions) have workgroup
execution and memory scope and require uniform control flow. Therefore we use barriers only for
the all-pairs tile and local scans. Inactive all-pairs lanes must still participate.

The [WebGPU resource-usage rules](https://www.w3.org/TR/webgpu/#programming-model-resource-usages)
treat each compute dispatch as a separate usage scope. Grid, force and integration are ordered GPU
commands with explicit resource roles. No CPU wait or readback is needed between those stages.

## Why count/scan/scatter first

Simon Green's NVIDIA paper [Particle Simulation using CUDA](https://developer.download.nvidia.com/assets/cuda/files/particles.pdf)
describes uniform-grid neighbor search and rebuilding the index each step. It outlines a variable-occupancy
extension using counts, prefix sums and scattering, as well as an alternative that sorts cell keys and
reorders particle data for more coherent reads.

We reuse our existing count/scan/scatter primitive because it has no fixed per-cell capacity and lets
this experiment focus on consuming the index. Sorting/reordering is a concrete follow-up, not presumed
to be faster for our workload. Likewise, tiled all-pairs provides a useful baseline at small populations.

## Local interaction is a modeling decision

The radius cutoff changes which forces exist. The grid is exact for this chosen local rule because
the search range covers every potentially relevant cell and an exact distance filter follows it.
This does not approximate the contribution of distant points. Replacing Cosmos's global many-body
force would need a separate model and accuracy study, such as hierarchical aggregation.
