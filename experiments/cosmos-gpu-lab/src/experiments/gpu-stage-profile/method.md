This experiment asks which parts of the composed Cosmos workload consume GPU time when **the inputs stop
changing between trials**. It compares the same rebuilt/retained resource paths as the
[capacity experiment](#/point-capacity/docs/reuse), using public luma APIs only.

## Controlled input

Choose an initial fixture or a graph after three resize cycles through 2,048 → 8,192 → 4,096 → 8,192 → 2,048.
The history case then changes to the selected logical count, advances two checked preparation frames and
freezes positions, topology, samples, alpha, tick/seed and camera. Point 0 is pinned; point 1 is absent.

Every trial restores the same float32 position array into both ping-pong buffers before the measured region.
Tick and cooling never advance during profiling. The capture fingerprint, exact positions and preparation
conditions are included in local JSON exports. At 4,096 logical points after history, the retained lane keeps
8,192 capacity while the rebuild lane holds 4,096.

```flow
Prepare · Initial fixture or checked resize history
Freeze · One position array, topology, samples, alpha, seed and camera
Anchor · Normal GPU replay and independent CPU whole-tick check
Restore input · Outside the timing interval, before every trial
Normal frame · One compute pass plus drawing | Diagnostic profile · Fourteen compute passes plus drawing
Validate · Exact replay position/force bits and the unchanged CPU position tolerance
Repeat · Two warmup rounds and eight measured rounds, with balanced lane/method order
```

## Two timing modes

**Normal** runs the ordinary resident compute-to-render path: all simulation dispatches share one compute
pass, followed by one render pass. A timestamp pair stays inside each pass; their durations are summed.

**Diagnostic profile** runs the same kernels, bindings, dispatch dimensions and algorithm order, with separate
passes for gravity force/integration; bounds; grid clear/binning; aggregates; sample selection; centroids;
far contributions/accumulation; repulsion resolve/integration; incoming and outgoing spring force/integration;
and drawing. The resolve pass includes near-field contributions and the stored far-field result.

Each of its 15 passes has an adjacent timestamp pair. No timestamp subtraction crosses a pass boundary.
This avoids the previously observed failing cross-pass timing path on M3/Metal. No shader arithmetic changes
are used for instrumentation.

**The split-pass sum is not a decomposition of the normal frame.** Pass boundaries change scheduling and can
add overhead. Compare it with the separately measured normal path; do not subtract medians to manufacture
an isolated stage cost. A stage's timing describes that diagnostic execution. CPU submit/completion times
are exported separately from GPU work. Sums of pass regions omit gaps between passes; a lower split-pass
sum does not establish lower end-to-end latency. Medians of individual stages also need not sum to the median
of their complete profile.

luma exposes asynchronous query results and pass-level begin/end indices through its
[QuerySet API](https://luma.gl/docs/api-reference/core/resources/query-set). Browser timestamp precision is
limited: Chrome documents [timestamp quantization](https://developer.chrome.com/docs/web-platform/webgpu/developer-features).
In these captures, small durations often land on steps around 0.066 ms, including zero. A zero stage median
does **not** mean free work; sub-resolution stages cannot be ranked reliably. Median interpolation between
quantized values can also produce a displayed value such as 0.033 ms.

Position restoration, initial allocation, query-result readback, snapshots and CPU validation are outside the
measured interval. Small per-tick uniform writes and command encoding remain part of CPU submission cost.
GPU durations cover the pass regions, not page wall time or end-to-end frame latency.

## Order and correctness

A round contains four combinations: rebuilt normal, retained normal, rebuilt profile and retained profile.
A rotating order makes each combination occupy each of the four trial positions twice in eight accepted rounds.
Warmup rounds are excluded. This removes fixed first-lane bias; it cannot remove every cache, thermal,
atomic-insertion or browser scheduling effect. The two lanes still own separate devices on the same adapter.

Both untimed normal anchors must agree in all final position/force bits and pass the original independent CPU
whole-tick position check. Every warmup and measured trial must reproduce its anchor exactly and pass that
same CPU tolerance. Non-finite output fails. The CPU reference and tolerance constants are unchanged.

The profiler is a scheduling/cost investigation, not a new force implementation or a layout-quality verdict.
It still uses the lab's eight samples, forced hierarchy, strict arithmetic candidate and minimal renderer.
Production defaults, remaining forces and other hardware remain separate migration gates.

## Run and reproduce

Open [Controlled GPU stage profiling](#/gpu-stage-profile). Select chain, communities or star, 4,096 or
8,192 logical points and the input state, then **Prepare + profile**. Keep the tab visible. **Stop** retains
partial trial data. A GPU median requires all eight valid measured samples; unavailable timestamps remain
unavailable, and partial runs cannot report a complete result. **Export JSON** retains the frozen input,
order, raw trials, checks and the first replay mismatch, if one occurs. Routine exports stay outside Git.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/stage-profile.test.ts
```

Native tests cover frozen-input replay across changed logical/grid/reduction sizes, every stage label,
unchanged CPU tolerance, cancellation and buffer cleanup. Pure tests also reject malformed or backwards
within-pass query values and verify balanced accepted order.

## Findings

Measured **11 November 2026**, **Apple M3**, standalone **Chrome 156**, pinned **luma 10.0.0-alpha.4**.
Six runs cover chain, communities and star at 8,192 after resize history; star at 4,096 after history; an initial
8,192-point star control; and a repeated 8,192-point history star. Every run uses two warmup and eight measured
rounds. The original CPU budget remains **`2e-5 + 3e-5 × abs(expected)`**, with exact flag comparisons.

All **240 warmup/measured trial checks and 12 normal-anchor checks pass**. Final position/force bits match
the normal replay exactly, including across the two resource policies. The five history runs additionally
pass 65 paired resizes and 70 preparation-frame checks. All recorded trial timers are valid.
Resetting between runs releases both lanes' tracked application buffers to zero; native regressions check
cleanup and partial-run cancellation as well.

### Normal timing does not show a consistent retained-buffer penalty

GPU medians in ms. Each cell is **rebuilt / retained**; each method/lane has eight measured samples:

| Frozen workload | Normal, 2 passes | Diagnostic, 15 passes |
| --- | --- | --- |
| Chain, 8,192 after history | 8.978 / 7.995 | 8.716 / 8.749 |
| Communities, 8,192 after history | 8.258 / 8.192 | 8.454 / 8.290 |
| Star, 8,192 after history | 13.074 / 13.533 | 13.402 / 13.435 |
| Star, 4,096 after history | 13.402 / 14.090 | 13.238 / 13.959 |
| Star, 8,192 initial control | 12.878 / 13.042 | 13.173 / 12.878 |
| Star, 8,192 repeated history | 14.516 / 14.352 | 14.385 / 14.385 |

Ranges overlap. For the first frozen history star, normal rebuilt/retained ranges are **12.059–15.532 ms**
and **12.124–18.743 ms**; for its repeat, **12.321–17.170 ms** and **11.993–15.860 ms**.
The repeat reproduces the same captured float32 positions, alpha and tick, while timings still vary.
This weakens an explanation based solely on buffer reuse for the earlier evolving-frame gaps. It does not
identify a driver/clock cause or prove identical cost on every device.

The 4,096-point star keeps capacities **4,096 / 8,192** in the two lanes. Its exact-output checks establish
that the retained path respects the smaller logical count. This particular captured graph is not much cheaper
than the 8,192 case: point count alone does not determine cost. These are different evolved inputs, so the
comparison is not an isolated scaling or memory-capacity test.

### Dominant diagnostic stages

For the three main 8,192-point history captures, stage medians in ms, **rebuilt / retained**:

| Stage | Chain | Communities | Star |
| --- | --- | --- | --- |
| Strict gravity force | 2.261 / 2.261 | 1.966 / 1.966 | 1.245 / 1.311 |
| Grid aggregation | **3.637 / 3.539** | **3.342 / 3.342** | 1.999 / 2.064 |
| Far contributions + accumulation | 2.228 / 2.163 | 2.032 / 1.933 | 1.245 / 1.278 |
| First directional spring pass | Below useful resolution | 0.066 / 0.066 | **8.520 / 8.323** |
| Minimal drawing | 0.262 / 0.229 | 0.262 / 0.295 | 0.197 / 0.197 |

**The star is dominated by its hub gather**, not by buffer copying or basic drawing. The same first spring
pass remains dominant in the initial control (8.159/8.094 ms), the repeated history run (8.913/8.880 ms) and
the 4,096-point case (7.340/7.602 ms). Point 0 is pinned in this workload: its directional force is still
evaluated even though integration holds its location. The table labels this pass “incoming,” matching the lab.

**Chain and communities are dominated by aggregation, far-field evaluation and strict gravity.** The grid
aggregation kernel still traverses linked lists, orders source indices within a cell and uses a full-source
scan for crowded cells. That stage is a concrete optimization target. The measurements have not isolated
which of those branches dominates, nor established that replacing the binning pass alone would help.

Bounds, sample selection, integrations and many small spring/draw passes are close to the timer's useful
resolution. They are not zero-cost. Strict gravity's extra arithmetic remains a separate production-policy
question; this experiment changes no arithmetic and approves no faster failing control.

### What this suggests next for Cosmos

Keep the current strict reference and tolerance fixed. Prioritize a bounded study of the ordered high-degree
spring gather and the grid aggregation stage, with instrumentation that identifies crowded-cell occupancy and
work while preserving output. Use these frozen captures and normal-frame replay as the regression gate.
Any parallel reduction or different summation order must pass the existing checks before adoption.

The first controlled profile does not reproduce a stable, large GPU penalty caused by retained storage.
Memory retention and trimming remain real policy questions, independently of that timing result. Broader
production-default force coverage, rendering, host ownership and native-device qualification still remain on
the [migration roadmap](#/roadmap); the profiler should guide that work rather than postpone it indefinitely.
