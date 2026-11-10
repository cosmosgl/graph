## What this measures

The sweep compares production GLSL through luma v10 WebGL, direct WGSL and tiled WGSL. It measures the **force alone**
and **force + integration**, without rendering. This is an isolated exact-path comparison, not a complete Cosmos benchmark.

All three paths receive the same deterministic positions, samples and parameters. Every operation in a batch reads the
same source positions; integration overwrites a separate destination without feeding it back. No upload or reset occurs
inside the measured interval. The final force and destination are checked against the CPU after every batch, including
calibration and warmup. A mismatch stops the sweep without relaxing the tolerance.

## Repeatable procedure

1. Choose Uniform, Dense clusters or Both distributions in **Batched timing** on the demo.
2. Keep the tab visible and use **Run timing sweep**. Avoid other GPU-heavy work.
3. The sweep visits 128, 512, 1,024, 2,048 and 4,096 points, on separate devices that leave the demo untouched.
4. One pilot operation per backend selects a shared batch size: target 6 ms for the slowest lane, bounded to 4–64 operations for measured batches.
   The four-operation minimum keeps larger cases batched even when WebGL already exceeds the 6 ms target.
5. Two batched warmups precede seven recorded batches. Backend order rotates each round; lanes execute serially and complete before the next starts.
6. Read the median and minimum–maximum GPU duration per operation alongside completion time. Export timing JSON for local analysis.

**Stop sweep** finishes the in-flight batch and retains partial records. Leaving the page also cancels and releases
benchmark devices after pending work settles. The report requires all seven valid timer samples for a GPU summary;
unavailable, disjoint, timed-out or invalid samples are retained, not replaced with zero or silently dropped.

## The clock boundaries

```flow
Prepare · Create pipelines, upload inputs and calculate the CPU reference
Drain · Wait for previous GPU work before starting the timer
Time · First force pass begins → repeated fixed-input operations → last requested pass ends
Complete · Submit and wait for the GPU; record host completion separately
Inspect · Read timestamps and force / position outputs, then validate outside timing
```

GPU timestamps enclose all passes in the batch. WebGL uses luma command timestamps around the whole batch,
because the pinned alpha writes a pass-begin timestamp after its clear. This includes every render-target clear; WebGPU dispatches overwrite
all active outputs. Host submission includes command encoding and submission. Completion includes submission and a luma
fence wait, but excludes output readback, CPU comparison and timestamp-result readback. Dividing completion by batch size
amortizes synchronization overhead; it is not the latency of one interactive tick.

Timestamp queries are optional. The [luma QuerySet API](https://luma.gl/docs/api-reference/core/resources/query-set)
provides pass timestamps and duration readback; WebGL uses its disjoint timer extension. This implementation uses those
APIs from the pinned alpha, without native handles. The [WebGPU specification](https://www.w3.org/TR/webgpu/#timestamp)
permits implementation-dependent timing and coarsening. Batching improves resolution for short work but does not turn a
zero-duration reading into proof of free work. No browser security flags need changing.

Treat native results as workload- and device-specific. Shared-memory tiles still perform quadratic pair arithmetic;
they only change how sources are loaded. GPU timestamps alone do not establish frame throughput, application latency
or behavior on another GPU. Repeat the sweep and compare variation before preferring a kernel.

## Apple M3 findings

Two complete sweeps on 9 November 2026 used the final protocol above: minimum four operations, seven measured batches,
command timestamps including all WebGL clears, and no concurrent lab tests. The environment was the Codex in-app
Chromium 157 browser on Apple M3: ANGLE Metal for WebGL, Apple WebGPU, luma 10.0.0-alpha.4. Parameters remained alpha 0.6,
repulsion 1, friction 0.85 and reference length 4,096. Earlier exploratory captures are excluded from these tables.

**All 120 result rows completed, all 840 recorded timestamp samples were valid, and all 1,200 output checks passed**,
including pilot and warmup checks, at the unchanged tolerance. No context loss was observed. These runs do not resolve
the separate weighted-link context-loss investigation.

### Force only

Each cell is the **range of the two run medians**, in milliseconds per operation. It is not a confidence interval or
the spread of individual samples. The UI and JSON retain each run's per-batch minimum and maximum.

| Fixture | Points | WebGL | WebGPU direct | WebGPU tiled |
| --- | ---: | ---: | ---: | ---: |
| Uniform | 128 | 0.222–0.291 | 0.053–0.097 | 0.040–0.085 |
| Uniform | 512 | 0.632–0.828 | 0.224–0.385 | 0.180–0.324 |
| Uniform | 1,024 | 1.405–2.570 | 0.410–0.606 | 0.377–0.655 |
| Uniform | 2,048 | 3.437–5.446 | 0.688–1.245 | 0.688–0.721 |
| Uniform | 4,096 | 5.373–5.865 | 0.967–0.999 | 0.836–0.836 |
| Clusters | 128 | 0.182–0.293 | 0.069–0.097 | 0.047–0.050 |
| Clusters | 512 | 0.457–0.832 | 0.208–0.384 | 0.175–0.328 |
| Clusters | 1,024 | 2.163–2.562 | 0.446–0.475 | 0.642–0.655 |
| Clusters | 2,048 | 4.130–4.291 | 0.803–0.836 | 0.623–0.672 |
| Clusters | 4,096 | 5.428–6.040 | 0.901–1.016 | 0.868–0.934 |

### Force + integration at 4,096 points

| Fixture | WebGL | WebGPU direct | WebGPU tiled |
| --- | ---: | ---: | ---: |
| Uniform | 6.421–6.654 | 1.016–1.147 | 0.999–1.049 |
| Clusters | 6.816–6.859 | 1.114–1.130 | 1.016–1.016 |

### What we can conclude

- **The exact WebGPU path is promising on this M3.** At 4,096 points, paired run medians were about 5.4–7.0× faster
  than the WebGL baseline across force-only and force + integration workloads. Amortized completion time also favored
  WebGPU: approximately 1.00–1.50 ms per operation versus 6.48–8.35 ms for WebGL. These are isolated measurements,
  not a Cosmos frame-rate claim or a comparison against a complete production luma v9 `Graph`.
- **Tiling is useful, not a universal winner.** It reduced the 4,096-point force-only median in both distributions
  in both repeats, by roughly 4–16% versus direct gather. At 1,024 clustered points the direct kernel was faster in
  both repeats. Force + integration also had mixed winners. Keep both kernels; do not select a portable default yet.
- **Small-workload timing varies substantially.** Some run medians nearly doubled, and some individual batch ranges
  overlapped widely. Fixed-input batches reuse data and amortize submission; evolving simulation, rendering, thermal
  state and other GPUs can produce different results. There is no reliable single crossover count here.
- **The next scaling question remains algorithmic.** Both exact kernels still visit all pairs. This comparison gives
  us a checked reference for the production hierarchical far-field and sampled near-field path above 4,096 points;
  it does not justify extending quadratic work to million-point layouts.

## Regression coverage

The many-body suite has 36 tests, including the existing force checks. New coverage checks real three-operation batch
outputs on all three backends, preservation of evolving positions, invalid batch sizes, timing-summary rules, common
batch calibration, rotating lane order, cancellation and disposal, and stopping on an incorrect GPU result.

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body/
```

Software-adapter tests validate behavior only. Keep raw timing JSON local; share this Markdown summary and reproduction
conditions. Repeat on other GPUs and in standalone Chrome before choosing a production kernel.
