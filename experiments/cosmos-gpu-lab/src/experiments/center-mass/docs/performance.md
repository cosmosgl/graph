# Performance

The live number is a latency observation, not a kernel benchmark. It currently includes:

1. Position upload.
2. GPU command encoding or WebGL draw setup.
3. Reduction execution.
4. GPU-to-CPU synchronization.
5. Readback.
6. Minimal point rendering.

That is useful for understanding the cost of the current demonstrator, but not for declaring one reduction primitive
faster than another.

## Comparison mode

The current demo favors correctness:

- Both backends receive the same tick.
- Results are read back every time.
- WebGL and WebGPU execute in the same page.
- Early ticks include driver and pipeline warm-up.

## Future benchmark mode

A defensible benchmark should:

- Select one backend at a time.
- Warm up pipelines before collecting samples.
- Run enough iterations to report median, p95 and variance.
- Avoid result readback on every iteration.
- Use WebGPU timestamp queries when available.
- Record browser, OS, adapter, feature profile, limits and point count.
- Separate upload, compute, readback and rendering measurements.
- Export a versioned JSON report.

WebGPU timestamp queries are optional. The benchmark must request the feature during device creation, check the created
device, and retain a CPU wall-clock fallback.

## Architectural expectation

The main WebGPU opportunity is not merely a faster center calculation. It is keeping simulation state on the GPU and
chaining grid construction, force evaluation, integration and rendering without a CPU readback between stages.
