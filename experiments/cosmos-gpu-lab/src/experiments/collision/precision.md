# Collision precision: the targeted correction

**The targeted WebGPU collision kernel passes all 1,700 tick gates and all 1,700 independent trajectory gates in the repeated M3 matrix, with zero measured pointwise drift from CPU.** The original native kernel and its recorded failures remain selectable controls. No tolerance, CPU reference or force-law constant changes.

Measured **12 November 2026**, Apple M3, Codex inline browser **Chromium 157**, pinned luma `10.0.0-alpha.4`. Native regression checks run separately in installed Chrome. This is a bounded result for the stated fixtures and arithmetic path; broader data, native GPUs and the larger collision algorithm remain open.

## The counterexample and intervention

The [original independent study](#/collision/docs/trajectories) found a cooled dense star failure at tick 5, alpha `0.9120108393559097`: two whole-tick coordinates failed, maximum error `0.1319580078125`. Gravity, corrected center, exact repulsion and both spring stages matched locally exactly. The first collision pass introduced a small force difference and a [one-ULP](#/vocabulary/ulp) position change; subsequent passes amplified it.

Reconstructing that native trajectory's input and replaying alternative kernels from the **same positions and alpha** gives:

| Collision arithmetic | Captured whole-tick gate |
| --- | --- |
| Original native f32 | Fails: 2 coordinates, maximum error 0.1319580078125 |
| Refined squares, roots and divisions alone | Same failure |
| Separately rounded correction contributions alone | Same failure |
| Both corrections together | Pass |
| Strict arithmetic reference | Pass |

The targeted kernel combines two changes:

1. Compute individually rounded squared components before adding them. Refine division and square-root results with an explicit residual correction; this applies to distance, radius weighting and normalization/capping operations that use these helpers.
2. Round each `direction × weight` contribution before adding it to the accumulated correction, using the existing finite-normal integer product helper.

```wgsl
// Residual refinement after the native seed.
let q = a / b;
let refined = q + fma(-q, b, a) / b;

// Preserve the product's float32 rounding before accumulation.
correction.x += roundedProduct(direction.x, weight);
```

The square-root helper similarly uses `q + fma(-q, q, a) / (2. * q)`, with an explicit zero guard. Squared components use the existing `roundedSquare`. The native golden-angle coincidence direction remains; the stricter reference keeps its high/low trigonometry.

A fused multiply-add can round a product-plus-sum differently from separately rounded operations. The ablations identify distance evaluation and contribution accumulation as the relevant intervention here; they do not prove one particular GPU instruction caused every discrepancy. WGSL permits implementation-dependent floating-point evaluation; see the [evaluation rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation).

These residual helpers are **tested corrections, not a universal correctly-rounded guarantee**. The integer product helpers cover their documented finite-normal range and retain native fallback outside it. Source order, disc weighting, strength/cooling, maximum correction, friction, pinning and absence follow the existing contract.

```flow
Read the current GPU positions and sizes
Round squared components · Refine roots/divisions
Compute each overlapping disc contribution
Round direction × weight · Accumulate in original source order
Apply the unchanged strength, cap and integration
Repeat from updated GPU positions
```

The implementation remains GPU-resident through public luma APIs. It uses the existing buffers, dispatch sequence and rendering path, with no CPU intermediate substitution. The collision demo defaults to **Targeted distance + contributions**; native f32 and strict reference remain explicit choices. Distance-only and contribution-only ablations are exercised by the native precision regression.

## Repeated independent matrix

The repeated cases use exactly the original fixtures, topology, sizes, weights, fixed sample data, alpha schedules and budgets. CPU terminal metrics and overlap match the original runs exactly. WebGL reproduces its original tick-gate counts; its implementation is unchanged.

Each targeted row passes both the tick gate and the accumulated raw-coordinate gate on **every tick**, with zero measured RMS/max pointwise drift throughout. The comparison carries each GPU's own output into its next tick; it performs no ordinary reset to CPU positions. The masked and isolated controls are included.

| Workload | Original native tick gates | Original native trajectory gates | Targeted tick and trajectory gates |
| --- | --- | --- | --- |
| 128 uniform · chain · fixed | 100/100 | 35/100 | 100/100 each |
| 128 uniform · communities · fixed | 100/100 | 25/100 | 100/100 each |
| 128 uniform · star · fixed | 100/100 | 5/100 | 100/100 each |
| 512 clusters · chain · fixed | 100/100 | 1/100 | 100/100 each |
| 512 clusters · communities · fixed | 100/100 | 1/100 | 100/100 each |
| 512 clusters · star · fixed | 100/100 | 1/100 | 100/100 each |
| 512 clusters · chain · cool 300 | 300/300 | 1/300 | 300/300 each |
| 512 clusters · communities · cool 300 | 300/300 | 1/300 | 300/300 each |
| 512 clusters · star · cool 300 | 299/300 | 1/300 | 300/300 each |
| 8 masks · star · cool 100 | 100/100 | 100/100 | 100/100 each |
| 128 uniform · isolated control | 100/100 | 100/100 | 100/100 each |

Across these 11 runs, the targeted path passes **1,700/1,700** of each gate, versus the original native kernel's **1,699 tick gates and 271 trajectory gates**. Production WebGL retains **1,589 tick gates and 217 trajectory gates**. These counts describe the tested matrix, not a general probability of correctness.

The current numerical budgets remain `2e-5 + 3e-5 × |reference|`, with springs at their existing tighter `2e-6 + 2e-5 × |reference|` budget. Flags stay exact. The existing absence contract remains intact, including NaN sentinels and the separately recorded unused spring outputs.

Layout geometry now follows the independently evolved CPU in this matrix. That does not establish universal layout quality or remove residual physical overlap: cooled CPU star penetration, for example, remains about 2.451 world units. The [original geometric observations and definitions](#/collision/docs/trajectories) still apply.

## Added normal-frame GPU cost

**Compare collision precision cost** freezes CPU geometry and the current alpha. Both controls keep collision enabled, including four collision passes, spring contact floors and the corrected center reduction. Only collision arithmetic changes. Native and targeted pipelines are allocated on the same timing backend before warmup.

Measurements use the **512-point dense star**, alpha 1 at initial geometry and approximately 0.001 after 300 CPU ticks. Two blocks each contain four warmup pairs and twelve measured pairs; control order alternates. Each observation batches four restored normal compute-plus-render frames. Camera and complete disc coverage stay fixed across controls.

| Geometry / block | Native frame ms | Targeted frame ms | Median paired added ms | Pair range ms |
| --- | --- | --- | --- | --- |
| Initial / 1 | 2.925 | 3.785 | 0.844 | 0.541 … 1.049 |
| Initial / 2 | 2.990 | 3.965 | 0.893 | 0.459 … 1.688 |
| Cooled / 1 | 3.219 | 3.883 | 0.631 | 0.360 … 0.836 |
| Cooled / 2 | 2.826 | 3.285 | 0.475 | 0.213 … 0.639 |

Both scalar preflights, all **512 captured frames**, exact anchor replays, original whole-position checks and timestamp queries pass. Every measured pair difference is positive. Median added cost is roughly **0.84–0.89 ms initially (29–30%)** and **0.48–0.63 ms cooled (17–20%)** on this device.

Columns are independent medians; the added cost is the median paired difference. GPU frequency and measurement variability remain visible in the ranges. Uploads, restoration/capture copies, CPU reference work and readback are outside the timestamp intervals. This is complete experimental GPU frame work with minimal rendering, not production Graph FPS or a cross-device performance policy.

Both controls must pass numerical acceptance. The known failing native input at tick 5 rejects a precision-cost comparison even when the targeted output passes; it cannot supply an accepted speed estimate. The initial and cooled timing inputs above pass both controls. Raw trials remain available through local JSON export. The older strict-kernel cost is documented separately in the [baseline findings](#/collision/docs/findings); this study does not infer a new strict/native speed ratio.

## Reproduce and remaining scope

Open [Collision constraints](#/collision), choose **Combined forces → Independent layouts → Targeted distance + contributions**, and retain **High/low sum · corrected**. Use uniform / 128 / one pass or clusters / 512 / four passes, select a topology, then run 100 fixed-alpha ticks or the 300-tick cooling schedule. Collision cooling exponent stays zero. The [original study](#/collision/docs/trajectories) lists every fixture and schedule.

For timing, choose clusters / 512 / star / four passes. Measure at reset, then run the 300-tick schedule and measure again. Both comparisons use the same frozen CPU geometry for their two controls. Export JSON locally; the source-controlled report contains the knowledge and reproduction instructions.

Native checks: `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision`. `precision.test.ts` reconstructs the original native input and checks the corrected path plus diagnostic ablations; `targeted-history.test.ts` checks independent dense cooling; `precision-cost.test.ts` verifies preallocated switching and rejection of a failing control. The focused collision/combined suite passes **108 tests**. Existing cases cover masks, radius overrides, padding, cooling and high-index coincidence.

This closes the selected M3 collision arithmetic counterexample and repeated small-graph matrix. It does not establish the hash/slot path above 4,096 points, all coordinate/parameter ranges, production scheduling, portable precision cost or full Graph readiness. The [roadmap](#/roadmap) now prioritizes production point styling/picking alongside the remaining force families.
