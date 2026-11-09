# Measuring useful work

The experiment records separate **grid build**, **force**, **integration**, **render**, and **complete
tick** measurements. The all-pairs path has no grid-build stage. Both paths use one shared device,
the same initial positions and force parameters, identical 480×480 canvases and the same circle shader.

## Calibrated batches

Each stage first runs one calibration operation. Its GPU interval selects an integer batch size targeting
4 ms, clamped to 1–64 operations. A quantized zero selects 64; unavailable or invalid GPU timing uses
calibration wall time instead. This is a heuristic, not a guaranteed duration limit. Expensive operations
can use a batch of one. The chosen size stays fixed for two unrecorded batch warm-ups and eight measured batches.

A batch encodes repeated operations into one command buffer. Only the first operation writes a start
query and the last writes an end query. Summaries and `gpuSamples`, `samples`, and `submitSamples`
are **milliseconds per operation**: whole-batch time divided by batch size. Raw timestamp pairs and
`batchCompletionSamples` / `batchSubmitSamples` retain whole-batch durations. The export includes
batch size and calibration evidence for every stage (schema version 3).

CPU submission ends immediately after submit; wall completion includes encoding, driver work, queue
latency and GPU execution. Their per-operation values amortize one submission and queue wait over the
batch. They are not the latency of an independently submitted frame. GPU batches reduce the relative
impact of timer quantization; they do not increase the timer's underlying resolution.

## GPU timestamp intervals

The luma-created device requests `timestamp-query` as an optional feature. If enabled, benchmark
passes write start/end queries and report separate GPU p50/p95 values. Otherwise GPU fields are null
and the interface shows **Unavailable**; all wall-time measurements still work.

Force, integration and rendering span the first pass beginning through the last pass end in the batch. Grid time spans the beginning
of the first count/scan pass through the last scatter, including intervening offset-to-cursor copies and subsequent counter clears.
Complete-tick time spans the first compute pass through the final render pass, including intervening
GPU stages and gaps. **Only the first grid-counter clear in a batch is excluded
from grid and grid-tick GPU intervals**; all later clears and every wall-time clear are included. These are GPU pipeline
intervals rather than isolated shader instruction timings or sums of individual pass times.

After the measured submission completes, a separate submission resolves the queries and copies them
into a mapping buffer. Thus query resolution, copying and CPU mapping are outside both measured
intervals. Timestamp writes themselves are part of the instrumented workload. Readback also affects
the pacing between samples, so this is not a sustained-throughput benchmark. Each result is consumed
before reusing the two query slots; the readback buffer is unmapped before its next GPU use.

Query values are unsigned 64-bit nanoseconds. Subtraction happens as BigInt before conversion to
milliseconds. Negative deltas (possible counter resets) and deltas exceeding exact integer conversion
are retained as raw values but excluded from summaries and counted as invalid. Zero deltas are retained:
browser precision reduction can quantize a short interval to zero. No automatic speed ratio is inferred.

The benchmark holds the input snapshot fixed. Each integration overwrites the inactive output buffers;
each render draws that result. Each complete-tick operation executes build (grid only), force, integration and
render in order. Every operation repeats the same frozen input; batches do not advance simulated time. The input/output roles do not swap between benchmark samples, so
the distribution stays identical across methods. Playback does swap them on every tick.

## Interpretation limits

- Standalone stages each incur a queue wait. Their times must not be added to predict complete-tick time.
- Setup, upload, CPU reference and validation readback are outside the timed samples.
- Standalone force timings assume an already-built grid. Use complete ticks when judging the index's payoff.
- Batches reuse the same resources and benefit from warm caches. Their per-operation cost is not a
  prediction of moving simulation frame rate. Rendering clears the same canvas for every operation;
  compositor/presentation cost is absent.
- Calibration, GPU clocks and system load can produce different batch sizes across methods and runs.
  Inspect raw batch intervals and repetition variability before comparing small differences.
- A batch capped at 64 can still be shorter than the target. Quantization and invalid samples remain visible.
- The single-preset Benchmark runs methods sequentially, all-pairs first. Thermal and order bias remain; repeat runs on the same
  device and record power state. This first experiment does not provide a hardware-independent ranking.
- All-pairs is capped at 4,096 points; larger presets intentionally have no matching GPU baseline.
- Dense clusters and large radii increase candidate count. Grid construction can scale while neighbor
  traversal becomes quadratic. Mean candidates per point is shown by validation to explain this effect.

## Export and next measurements

JSON exports contain preset parameters, browser metadata, validation details, raw submission and
completion samples, and GPU timestamp pairs with summaries. Add physical GPU, power state and the tested commit when sharing
a report; browser metadata alone does not identify hardware reliably.

The [parameter sweep](#/neighborhood-forces/docs/sweep) varies count, density, radius and cell size with
seeded order and reversed method order across repetitions. Historical reports in Results predate GPU
timestamp support; their numbers are wall time only. The [batched findings](#/neighborhood-forces/docs/batched-results)
include two larger native-device sweeps, raw data and validation failures.

Useful next optimizations to compare, rather than assume, include sorting/reordering positions for
coherent neighbor reads and alternative grid builds
under atomic contention. Neighbor-list reuse requires a displacement/radius safety margin; reusing a
stale grid without such a rule can omit real neighbors.
