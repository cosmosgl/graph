---
source: Recorded findings
recorded: 2026-11-11
device: Apple M3; standalone Chrome 156
scope: GPU time per frame for simulation with and without offscreen drawing.
---

Each graph had **8,192 points**. The chart shows the median GPU time for refined simulation and
drawing to a **480 × 340** target. Using luma **10.0.0-alpha.4**, each batch ran the first four frames
of a 100-tick cooling schedule. Each workload had two warmups and seven measured batches.

```result-chart
{
  "title": "The star took over twice as long as the chain",
  "context": "Recorded median GPU work per frame · Refined simulation and drawing · 8,192 points each",
  "unit": "ms",
  "bars": [["Chain", 5.423], ["Star", 12.845]]
}
```

## Findings

All 120 replay checks passed across the twelve workloads. The timed intervals excluded position
readbacks and CPU force checks.

Median GPU work per frame (ms)

| Graph | Native simulation | Native + drawing | Refined simulation | Refined + drawing |
| --- | --- | --- | --- | --- |
| Chain | 4.375 | 4.473 | 4.817 | **5.423** |
| Communities | 3.260 | 3.391 | 4.719 | **5.407** |
| Star | 5.800 | 5.980 | 12.206 | **12.845** |

| Refined compute + drawing | GPU range | CPU submit median | Completion median |
| --- | --- | --- | --- |
| Chain | 5.210–5.636 ms | 1.400 ms | 5.900 ms |
| Communities | 5.194–5.816 ms | 0.425 ms | 5.250 ms |
| Star | 12.780–13.222 ms | 1.125 ms | 13.200 ms |

The strict arithmetic cost is especially visible on the serial star hub: its refined frame GPU work is about
**2.1×** the native-f32 control. The native control still has known CPU-reference failures, so its lower cost
is not a validated production alternative. Chain and community costs are similar in the refined path despite
different topology. These observations support an engine-slice feasibility result, not full-renderer readiness.

A preliminary one-frame-per-batch run had much wider ranges, including a chain native-frame median of 14.35 ms
with a 5.70–17.11 ms range. It is excluded from the table above. The retained policy uses at least four frames;
timing conditions and batching materially affect the observation. The remaining ranges, sequential mode order
and single tested GPU still limit small-difference claims. Subtracting medians is not an isolated render-cost test.

The same session also checked [edits to a running layout](#/resident-layout-edits?section=doc-method-recorded-check).

## What counts as a frame here?

```flow
One compute pass · Gravity, GPU bounds, hierarchy, repulsion, incoming/outgoing springs and all four integrations
Optional render pass · Clear the target; draw straight links and circle quads from the resident positions
One submission · Keep the entire frame's GPU commands together
Cool · Advance alpha on the CPU for the next frame
```

The shaders still execute in production force order and integrate after each force. Sharing a compute pass
does not combine their forces or change the arithmetic. The CPU prepares each stage's uniform buffers before
submission; each buffer sees one consistent alpha and sampling seed for that frame. Dispatches retain their
producer/consumer order. The staged control keeps its separate passes and post-gravity readback for CPU bounds.
This relies on stage-specific uniform buffers: do not overwrite one pending buffer with different stage values
before submission. The two spring directions currently use identical uniform values, while their adjacency
buffers differ. A later force with different parameters needs its own compatible scheduling/data contract.

## Three different times

| Metric | Included | Excluded |
| --- | --- | --- |
| **GPU work** | Sum of adjacent begin/end timestamp pairs for the compute pass and, when enabled, render pass | CPU encoding, gaps between passes/submissions, presentation |
| **CPU submit** | JavaScript scheduling, uniform preparation, luma encoding and submission of the batch | Waiting for GPU completion |
| **Completion** | CPU submit plus a completion-fence wait | Query/result readback and validation |

GPU work and CPU submit may overlap; adding their medians is not a frame latency measurement. Quantization,
summed pass intervals and separate clocks also make small differences between these metrics unreliable.
Completion includes synchronization overhead and is not an FPS estimate. Drawing uses a fixed **480 × 340** target,
fixed camera, five-pixel circle quads and minimal straight lines. This is not the full Cosmos renderer.

The optional WebGPU [timestamp-query feature](https://www.w3.org/TR/webgpu/#timestamp-query) supplies GPU
measurements. An unavailable or invalid timer stays unavailable; the lab does not replace it with zero or
drop invalid samples. Small intervals may be quantized, so results include a range and repeated samples.

### Repeatable batches

The timing run measures native f32 and the passing refined arithmetic candidate, each with and without
drawing. All four rows use the initial fixture, selected cooling schedule and a common batch length of
4–16 evolving frames. Each batch resets positions and alpha **before** its timed interval. Seeds advance
deterministically within the batch; cooling advances after each frame. This measures the beginning of that
schedule, not every stage of a settled layout.

Four pilots choose a common batch length targeting about 12 ms, with a minimum of four frames to avoid
single-frame sampling. Slow frames can exceed that target. Each row then gets two warmups and seven
recorded samples. Simulation/drawing order alternates within a mode. Modes run sequentially, in reverse
order after calibration, to keep only one additional benchmark device alive; mode-order and thermal effects
remain possible. Compare ranges and rerun before drawing small-difference conclusions.

An untimed CPU-bounds replay runs through the same luma backend and supplies expected final positions and
forces. Every pilot, warmup and sample must match those buffer bits exactly: ten replay checks per row.
That verifies batch execution and scheduling; it is not an independent CPU force oracle. The existing
[strict CPU checks](#/combined-layout?section=doc-gravity-trig) retain their separate role and unchanged tolerances.
The native-f32 control retains its known CPU-reference mismatches even when its own replay matches.

### Why pairs stay inside a pass

On the tested M3/Chrome path, an initial timer spanning different compute passes/submissions produced
negative durations and Metal command-buffer “Insufficient Memory” failures. Reducing concurrent devices
did not resolve it. Tiny timer checks and the ordinary resident workload isolated this from force correctness.
The retained method uses both timestamps inside each pass and sums their durations. It avoids the failing
timing path, and its measurements include all simulation dispatches plus optional drawing. This observation
does not establish a universal WebGPU limitation or prove the driver's root cause.

## Reproduce

Open [Timing a GPU layout frame](#/resident-frame-timing), choose the graph, point count and cooling
schedule, then select **Measure frame time**. Keep the browser visible. **Stop** retains partial samples.
**Export samples** saves the samples and validation checks.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/frame-benchmark.test.ts src/experiments/combined-layout/frame-timing.test.ts
```

The batch test checks that every dispatch runs in every measured frame.
