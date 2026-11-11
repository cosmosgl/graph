This experiment now measures the **resident engine slice** and checks edits to a running layout.
Both features use the public luma APIs and the same force kernels as the staged reference.
Production Cosmos still needs its remaining forces, full renderer, interaction and embedding contracts.

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

**Time resident frames** runs native f32 and the passing refined arithmetic candidate, each with and without
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
[strict CPU checks](#/combined-layout/docs/gravity-trig) retain their separate role and unchanged tolerances.
The native-f32 control retains its known CPU-reference mismatches even when its own replay matches.

### Why pairs stay inside a pass

On the tested M3/Chrome path, an initial timer spanning different compute passes/submissions produced
negative durations and Metal command-buffer “Insufficient Memory” failures. Reducing concurrent devices
did not resolve it. Tiny timer checks and the ordinary resident workload isolated this from force correctness.
The retained method uses both timestamps inside each pass and sums their durations. It avoids the failing
timing path, and its measurements include all simulation dispatches plus optional drawing. This observation
does not establish a universal WebGPU limitation or prove the driver's root cause.

## Editing a running layout

Use **Step + check**, apply an edit, then step again. Edits preserve the current tick and alpha.

- **Move + pin point 0** patches one `vec4` record in both position buffers. It uploads 32 bytes per lane,
  changes no other records and preserves the ping-pong buffer selection. Pinning keeps that position fixed
  through subsequent integration.
- **Replace links** builds stable directional CSR for the selected topology, uploads a new buffer bundle,
  then switches both springs and drawing to it. The device, kernels and position buffers stay alive. Empty
  links, capacity growth and shrinkage are supported within the existing point index space.

Topology validation/allocation happens before replacing a lane's old bundle. Old buffers are destroyed after
the swap; [WebGPU buffer destruction](https://www.w3.org/TR/webgpu/#dom-gpubuffer-destroy) allows already
submitted work to complete. The update table reports CPU build/allocation/upload submission time and buffer
bytes, not GPU completion latency or peak memory. JSON includes versions and retained-resource checks.

The [capacity experiment](#/point-capacity/docs/reuse) separately validates point-count changes, growth and
retained storage. Shared host devices, device recovery and atomic updates across independently owned devices
remain future work. An execution error requires resetting the comparison.
Timing uses fresh fixtures on a separate device and preserves the displayed comparison and edit history.

## Reproduce

Open [GPU-resident layout](#/resident-layout), choose graph/point count/cooling, and select **Time resident frames**.
Keep the browser visible. **Stop** retains partial rows; **Export JSON** saves local timings and update history.
Reports belong outside Git; retain concise Markdown findings and these instructions.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/frame-benchmark.test.ts src/experiments/combined-layout/frame-timing.test.ts src/experiments/combined-layout/resident-updates.test.ts src/experiments/combined-layout/resident.test.ts
```

The update regression checks untouched positions, retained resource identities, growth/empty/shrunk links,
pinning, invalid-update rejection and subsequent whole-tick agreement with the unchanged CPU tolerance.
The batch test also verifies that every dispatch runs in every measured frame.

## Findings

Measured **11 November 2026**, **Apple M3**, standalone **Chrome 156**, pinned **luma 10.0.0-alpha.4**.
Each fixture has **8,192 points**, a **100-tick cooling schedule**, and four initial evolving frames per batch.
After two warmups, each row records seven samples. All **120/120 replay checks** pass across the twelve rows.
There are no position readbacks or CPU force checks inside the measured intervals.

GPU work in milliseconds per frame, median:

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

The same browser session checked four edited 8,192-point ticks: move/pin a point, replace star links with
communities, remove all links, then restore star links. All compared bits match at each tick; both lanes retain
their devices and position buffers. The one-point patch uploads **32 bytes per lane**. The community bundle
contains 712,672 buffer bytes, empty links 98,360 bytes including sizes/offsets, and star links 425,952 bytes.
Those are allocation sizes, not peak memory. CPU submission times were single observations, so the lab keeps
them in local exports rather than presenting them as portable update-performance results.

The focused native suite passes **13 tests**, including the 40-checkpoint resident matrix, frame replay and
an independent CPU whole-tick check after topology updates. Tolerances remain unchanged. Wider trajectories,
default-length cooling and other GPUs remain open. Bounded count changes and memory/lifetime checks now have
separate [capacity evidence](#/point-capacity/docs/reuse); full-engine memory and recovery still need validation.
