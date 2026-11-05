# Benchmark methodology

The Performance Lab compares matched WebGL 2 and WebGPU workloads on the same browser, device,
canvas and input size. It is intended for migration decisions, not for producing a universal
“WebGPU is X% faster” number.

## Current workloads

### Circle rendering

- WebGL submits one `point-list` vertex per point and uses `gl_PointSize` / `gl_PointCoord`.
- WebGPU submits an instanced six-vertex quad and reads positions and colors from storage buffers.
- Typed-array generation and upload happen before sampling.
- Each sample clears once, issues a batch of identical draws into the same 480×270 target, and
  normalizes the synchronized duration per draw. Keeping the draws in one pass prevents redundant
  clear/draw pairs from being discarded as overwritten work.

### Center-mass reduction

- WebGL draws every position into a 1×1 `RGBA32F` attachment with additive float blending.
- WebGPU performs a hierarchical compute reduction through ping-pong partial buffers.
- Position generation, pipeline creation and allocation happen before sampling.
- Several reductions are batched per sample; reported times are normalized per reduction. WebGL
  clears once and additively accumulates every draw in the batch, while WebGPU records every
  reduction into one compute pass, so intermediate work remains observable to the next operation.
- One readback after measurement checks each result against the same CPU reference.

## Timing boundaries

Every sample exposes two measurements:

| Metric | Begins | Ends |
| --- | --- | --- |
| CPU submit | before command encoding / WebGL calls | immediately after submit / draw calls |
| Synchronized completion | same start | after `queue.onSubmittedWorkDone()` / `gl.finish()` |

The completion metric includes JavaScript encoding, driver/API overhead, GPU queue latency and GPU
execution. It intentionally forces synchronization so both APIs have a portable completion point.
It is **not** equivalent to a hardware timestamp query and should not be presented as pure shader
duration.

After `gl.finish()`, each WebGL batch reads one pixel from its target. This makes the batch output
observable so a driver cannot discard overwritten rendering as dead work. The fixed readback cost is
amortized across the batch but remains part of WebGL completion time; WebGPU uses
`queue.onSubmittedWorkDone()` without a readback. Treat this as a practical browser baseline, not a
perfectly symmetric hardware measurement.

## Sampling

The quick preset performs two unrecorded warm-ups and six recorded samples. The stable preset uses
five warm-ups and twenty recorded samples. Each sample batches enough identical operations to rise
above coarse browser timer resolution, then normalizes the result per operation. Backends alternate
first position between samples to reduce a systematic ordering bias.

The results show median (`p50`) and tail (`p95`) rather than only an average. Pipeline compilation,
resource allocation, and upload are reported as setup time but excluded from sampled iterations.
If a median batch finishes in under one millisecond, the table suppresses throughput and relative
speed because privacy-reduced browser timers do not provide enough resolution for a defensible ratio.

## What an exported report contains

- workload and parameters;
- warm-up, sample and batch counts;
- raw submit and completion samples;
- p50, p95, minimum and maximum;
- throughput derived from completion p50;
- correctness status;
- browser user agent, logical CPU count, device-pixel ratio and canvas size.

Adapter identity is not consistently exposed with the same detail across browsers. Record the
physical device and power state alongside exported JSON when results are used in a decision log.
