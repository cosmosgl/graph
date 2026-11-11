## What this gate tests

This experiment combines the accepted **hub prefetch** (degree ≥1,024) and
**cached grid IDs with a 32-index sort**. Both lanes use the same strict force
arithmetic and production routing: exact all-pairs at **≤4,096** points,
hierarchical repulsion above that cutoff. Earlier experiments retain their
forced-grid controls.

```flow
Shared graph and deterministic samples · point 1 absent; point 0 optionally pinned
Evolve the baseline and combined candidate · same cooling and random seed
Check every complete tick · unchanged CPU budget and exact candidate replay
Replay four stages on the final input · tighter spring gates remain unchanged
Check a full-strength tick on the evolved geometry · before accepting timing
Measure ordinary compute + render passes · four restored frames per trial
```

The CPU check evaluates each complete tick independently from that tick’s actual
starting positions. It is not an independently evolved CPU trajectory over the
entire cooling schedule. The baseline and candidate do evolve independently on
the GPU, with no CPU positions injected into either trajectory.

## Dense-community arithmetic

The initial 8,192-point clustered-community tick failed two final coordinates.
Gravity and all six far-field levels matched the CPU bit for bit. The first
differences appeared in the near-field calculation; ordered spring stages then
amplified them. Replacing `normalize` with explicit refined roots and divisions
left one final failure. Explicitly rounding pair products, cell weights, jitter
and clipping products before accumulation resolved it.

| Near-field path | Final position failures on M3 |
| --- | --- |
| Native builtins and products | 2 |
| Refined roots/divisions | 1 |
| Refined roots/divisions + rounded products | 0 |

For example, point 4,882’s repulsion-stage y position differed by only
`0.0000038147`, but its final y differed by `0.0000610352`, beyond the unchanged
coordinate-dependent budget. Comparing each spring only on its actual GPU input
missed this composition error; the independent complete-tick check caught it.

Both the 4,096-point forced-grid control and the 8,192-point hierarchy now pass
their complete initial ticks on the Apple M3. Every traced near- and far-field
value matches the scalar CPU oracle exactly in those regressions. The general
budget remains `2e-5 + 3e-5 × abs(expected)`; spring stage checks retain
`2e-6 + 2e-5 × abs(expected)`. This is bounded evidence on one GPU, not a promise
of bitwise CPU agreement across devices or all future geometries.

The trace stores its final force inside the trace buffer, keeping resident-bounds
diagnostics within WebGPU’s portable minimum of eight storage bindings per stage.

WGSL allows reassociation and fusion and specifies builtin accuracy budgets.
The observed improvement is consistent with those rules; it does not identify a
particular generated GPU instruction or establish a driver defect. See
[WGSL floating-point accuracy](https://www.w3.org/TR/WGSL/#floating-point-accuracy),
[reassociation and fusion](https://www.w3.org/TR/WGSL/#reassociation-and-fusion), and
[luma’s precision guide](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision).
Residual refinements still use WGSL floating-point operations, so the passing M3
result needs independent validation on other adapters. Integer-controlled product
rounding covers finite normal inputs/results, with native fallback outside that range.

## Production cutoff

Native regression tests cover **4,095, 4,096, 4,097 and 8,192** points, including
local stage gates, independent complete-tick CPU positions, and identical normal
versus staged outputs. A resident allocation also crosses the cutoff in both
directions without reallocating its position buffers. Exact mode does not build
a hierarchy; requesting a grid diagnostic in that mode fails explicitly.
This lab allocation retains resources for both branches to support logical
count changes. Skipping grid dispatches does not yet eliminate their allocated
storage or pipeline setup cost.

## Measured acceptance on Apple M3

Chrome 156, pinned luma `10.0.0-alpha.4`, 8,192 points, eight near-field slots,
unit spring weights, gravity `0.25`, friction `0.85`, point 0 pinned and point 1
absent. Both timing lanes are WebGPU. These figures compare the strict baseline
with **hub prefetch + cached grid aggregation**, not production WebGL performance.

Every case evolved for the stated cooling schedule, then passed a full-strength
probe (`alpha = 1`) on the final geometry. Each sweep ran twice, reversing case
order for the second block. Values below are **baseline → candidate GPU ms per
ordinary compute + render frame**, shown separately for both blocks.

| 100 cooled ticks | Block 1 | Block 2 | Time saved |
| --- | --- | --- | --- |
| Chain, uniform | 5.28 → 4.67 | 5.54 → 5.01 | 9.6–11.5% |
| Chain, clusters | 5.32 → 4.60 | 5.36 → 4.82 | 10.1–13.4% |
| Communities, uniform | 5.20 → 4.54 | 5.19 → 4.54 | 12.6–12.8% |
| Communities, clusters | 5.41 → 4.60 | 5.29 → 4.55 | 13.9–14.8% |
| Star, uniform | 12.19 → 10.48 | 12.08 → 10.35 | 14.0–14.2% |
| Star, clusters | 12.05 → 10.37 | 12.06 → 10.40 | 13.7–13.9% |

| 300 cooled ticks | Block 1 | Block 2 | Time saved |
| --- | --- | --- | --- |
| Chain, uniform | 5.59 → 4.72 | 5.35 → 4.65 | 13.0–15.5% |
| Chain, clusters | 5.68 → 4.96 | 5.50 → 4.87 | 11.5–12.6% |
| Communities, uniform | 5.46 → 4.89 | 5.14 → 4.52 | 10.4–12.0% |
| Communities, clusters | 5.43 → 4.60 | 5.13 → 4.51 | 12.1–15.2% |
| Star, uniform | 12.96 → 10.61 | 12.95 → 10.58 | 18.1–18.3% |
| Star, clusters | 12.08 → 10.26 | 12.94 → 10.48 | 15.0–19.1% |

All **24 rows** passed: **9,600** evolving tick checks, **96** final local-stage
gates, **48** normal-frame anchors, **3,072** normal timing captures and **768**
separate diagnostic captures. All grid aggregates, slots, centroids and baseline/
candidate output bits matched at the final stage gates. Every row retired with
**0 / 0 tracked application-buffer bytes** remaining. Tick and timing counts include both
lanes, and capture counts include warmups. Tracked buffers exclude driver,
pipeline and texture allocations.

The candidate won all 12 measured pairs in 23 rows, and 10/12 in the remaining
300-tick clustered-community row. An initial-star cost check passed before the
long sweeps: **12.52 → 10.56 ms**. A duplicate-baseline star control measured
**12.71 → 12.62 ms** (−0.6%, 5/12 paired wins). The ordinary 4,096-point exact
community path also passed all captures: **7.33 → 7.29 ms** (−0.6%, 5/12 wins).
Neither optimization changes that exact-path workload at this degree.

**Conclusion:** the two optimizations compose correctly in this bounded matrix
and retain useful normal-frame gains. They remain opt-in. Production’s default
5,000-decay schedule, variable spring lengths/weights in composition, adaptive
sampling, larger/multi-hub graphs, remaining forces and other GPUs remain open.

## Reproduce

Run `pnpm --filter @cosmos.gl/gpu-lab dev`, then open
[Production layout gates](#/layout-acceptance). Keep the tab visible.

1. Check each boundary count with **Initial** input.
2. Check the 8,192-point star at Initial before starting long trajectories.
3. Select **After 100 cooled ticks + full-strength probe**, then run the graph
   and density sweep. Repeat with **300**. The sweep repeats the cases in reverse
   order for a second block. Point 0 can also be unpinned.
4. Compare against **Duplicate baseline** to gauge run-to-run variation.
5. Export JSON for local inspection or a failure replay. Commit concise findings,
   settings and reproduction steps; keep machine-specific measurement files local.

Each timing block alternates lane order, discards four warmup rounds and retains
twelve measured rounds per lane. Each trial contains four GPU-restored frames.
Every captured frame must match its staged anchor and the CPU whole-tick budget.
Copies, buffer creation, CPU work and readback stay outside the pass timestamps.
Diagnostic profiles run separately and apply only to hierarchical rows.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/dense-replay.test.ts src/experiments/combined-layout/production-routing.test.ts
```
