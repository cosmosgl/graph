# Center attraction in the combined layout

Cosmos’s optional `simulationCenter` force attracts each point toward the current centroid. It runs **after gravity and before repulsion**, with its own integration pass. The production default is **0 (off)**; this experiment also offers strengths 0.1 and 1. The earlier [matched baseline](#/matched-layout/docs/findings) uses center off.

```flow
Gravity · integrate positions
Sum present positions and count · pinned points contribute; absent points do not
Divide sums by count · the current centroid
Center attraction · integrate, preserving pins and absent points
Repulsion · bounds use the post-center positions
Incoming springs · integrate
Outgoing springs · integrate, then cool
```

Production GLSL calculates `delta = centroid − point`, its length and angle, then a correction of `alpha × center × length × 0.01` in that direction. The WebGL lane imports those shaders unchanged. A clear precedes every additive accumulation, and blending is explicitly disabled for the following force/integration/draw passes.

WebGPU uses luma kernels to reduce present `vec4` positions into sums/count in 256-invocation workgroups, recursively reducing partials until one aggregate remains. The current default retains high/low limbs per coordinate through every level, using integer-controlled luma `sum_fp64`, before writing one float32 aggregate. This [center correction](#/collision/docs/findings) fixes the observed dense four-pass collision failure at unchanged tolerance. The original float32 tree remains a selectable control in the collision experiment.

The polar force still uses the existing refined arithmetic helpers and integrates through the strict candidate. All stages, including reduction and the next force, consume GPU-resident buffers in the resident normal frame’s compute pass. No float atomics, CPU centroid upload or per-tick reduction readback is required by this path. The [parallel reduction guide](#/concepts/reduction) explains the tree.

The new independent CPU oracle sums stored float32 positions in JS double precision, rounds the aggregate to its GPU format, then evaluates the polar force with explicit float32 rounding and the existing integrator. It does not mimic a GPU reduction tree or the WebGL blend order. Those accumulation orders can differ, so aggregate checks accompany the original force and position gates. The numerical constants and pre-existing reference paths remain unchanged.

Pinned points influence the centroid but their positions remain pinned. Absent NaN sentinels are excluded before adding coordinates. All-absent inputs produce zero forces; coincident points already at their centroid have zero attraction. The standalone center tests exercise these cases in both GPU APIs.

## Comparing layouts

Choose **Center attraction = 1** and run the matched comparison. The first/tenth/final frozen checks now include a center stage and its aggregate. Bounds and the shared adaptive sample tape use the post-center state. Each GPU and the CPU continue independent trajectories; restoring probes and captured failure replay keep their original behavior.

For an off/on quality comparison, run the same fixture, count, distribution, pin and cooling schedule with center off and with center 1. Keep the resulting scores separate: attraction can change size, motion and the balance with repulsion and springs. A smaller drawing or a lower spring mismatch alone does not establish better readability.

## Measuring added GPU cost

**Measure center GPU cost** freezes the current CPU geometry, alpha, tick seed, sample count, topology and camera. It creates isolated timing backends, allocates center resources before warmup, and alternates center 0 / selected strength within every pair. Two blocks reverse API order; each uses four warmup pairs and twelve measured pairs.

WebGPU batches four frozen normal frames per observation. Each frame has its own GPU-resident bounds, center reduction when enabled, remaining forces/integration and draw. Adjacent compute/render timestamp pairs are summed; restore/capture copies and validation readback lie outside those intervals.

WebGL times one frozen frame per observation through luma’s command timestamps, including all force/integration/drawing GPU passes and clears. Its bounds are precomputed from the validated preflight’s post-gravity/post-center positions, outside the timer. This is an explicit difference in the timed work. Compare off/on added cost **within each API**; the table does not establish an end-to-end cross-API speed ratio.

A result is accepted only when both controls pass their unchanged scalar preflight gates, every timed frame exactly reproduces its validated GPU anchor, whole-tick position checks pass, and all prescribed queries are valid. Failed or cancelled rows retain raw trials in JSON and cannot supply an accepted summary. Paired deltas include center reduction/force/integration **and any downstream work changes** caused by the extra attraction.

The added cost is the median of each pair’s `on − off` duration. Off/on columns are independent medians, so their difference can disagree with the paired median in noisy data. Percentages divide the paired median by the off median. Warmups must also pass the output and timer gates. Passing these gates establishes correctness of the measured workload, not statistical stability.

Timing backends reserve the selected sample tier in both controls; the interactive adaptive demo reserves 64. Initial geometry measurements freeze 32 samples before the first adaptive decision, while the measured 8,192-point cooled cases use 8. WebGL’s immediate command stream can include CPU/driver submission gaps inside its elapsed interval, especially for short workloads. These allocation and timing scopes remain separate from production Graph frame-time or memory claims.

## Native findings · 11–12 November 2026

**Historical float32-tree baseline:** the trajectory, quality and center-cost measurements in the following sections precede the high/low correction. They have not been rerun for the new reduction and must not be attributed to it. Current matched reports record the effective reduction in their parameters; center-cost exports record it separately. See the [new bounded correction evidence and paired cost](#/collision/docs/findings).

Apple M3, standalone Chrome 156, pinned luma `10.0.0-alpha.4`. Every run uses center **1**, a pin on point 0, explicit unit link weights, production spring variation and the shared adaptive policy. Distributions are uniform except dense 8,192-point communities, which start in two clusters.

Across **seven runs and 5,600 ticks**, WebGPU passes **567 / 567** frozen checkpoints and **7 / 7** full-strength probes. WebGL passes **549 / 567** checkpoints and **4 / 7** probes. All trajectories stay finite. Numerical tolerances and production GLSL remain unchanged.

| Points | Graph | Ticks | WebGL checkpoints | WebGPU checkpoints | CPU stress RMS | WebGPU drift / CPU radius |
| --- | --- | --- | --- | --- | --- | --- |
| 128 | Chain | 100 | 11 / 11 | 11 / 11 | 0.818654 | 0.00188% |
| 128 | Star | 100 | 11 / 11 | 11 / 11 | 0.420094 | 0.00445% |
| 512 | Communities | 100 | 9 / 11 | 11 / 11 | 0.754084 | 0.02203% |
| 8,192 | Chain | 100 | 10 / 11 | 11 / 11 | 0.984086 | 0.02981% |
| 8,192 | Dense communities | 100 | 9 / 11 | 11 / 11 | 0.946109 | 0.00821% |
| 8,192 | Star | 100 | 9 / 11 | 11 / 11 | 0.425401 | 0.18413% |
| 512 | Communities | 5,000 | 490 / 501 | 501 / 501 | 0.576157 | 2.50139% |

Stress uses all connected pairs at 128 points and the [documented landmark estimate](#/matched-layout/docs/method) above that count. Drift is from the independent trajectory, with no alignment. The long run’s WebGPU stress is `0.576267`, close to CPU’s `0.576157`, despite the **2.50% radius-normalized positional drift**. Passing frozen-input gates does not establish trajectory identity.

### Precision findings remain visible

At the first 8,192-point uniform checkpoint, WebGL fails **13,276 center-force components** in both chain and star. The chain’s restoring full-strength probe also fails 3,619 center-force components; the star’s fails 8,192. The aggregate count remains correct. Blend accumulation and the tree reduction have different floating-point evaluation orders; the center result is not a bit-exact reproduction of production WebGL’s blend arithmetic.

The first dense center-enabled WebGL tick also retains repulsion/spring failures and **6,076 whole-tick position failures**. Its center-only stage passes the local budget. This separates a local center gate from the composed numerical outcome. Full WebGL/WebGPU numerical parity is therefore still unproven, even though WebGPU passes the independent CPU reference on this matrix and layout scores stay close.

The first ordinary failure reproduces with identical output bits/check results and verified restoration in all five failing runs. Standalone native checks cover masks, absent NaNs, coincident/all-absent inputs, odd count 4,097, aggregate replacement on repeated calls, and center-resource shrink/empty/regrowth inside reserved capacity.

### Quality changes with the force

At 512-point communities after 5,000 ticks, CPU stress changes from **0.546703 with center off → 0.576157 with center 1**, while spring mismatch improves **0.347935 → 0.325511**. Center attraction makes the drawing more compact; these metrics expose a tradeoff rather than a universal quality improvement. The current dataset does not define an absolute quality acceptance target.

### Added GPU cost

Each cell below contains the two blocks’ median paired added milliseconds. Initial geometry uses alpha 1; geometry after 100 or 5,000 ticks uses alpha 0.001. All reported WebGPU blocks pass scalar, exact-output and timer gates. The rejected WebGL row retains its raw trials locally.

| Points / graph | Frozen geometry | Fixed grid samples | WebGPU added ms, blocks 1 / 2 | WebGL added ms, blocks 1 / 2 |
| --- | --- | --- | --- | --- |
| 128 / chain | Initial | Unused: exact | 1.155 / 1.499 | 0.197 / 0.313 |
| 128 / chain | After 100 ticks | Unused: exact | 1.008 / 1.483 | 0.233 / 0.141 |
| 512 / communities | Initial | Unused: exact | 1.032 / 2.154 | 0.297 / 0.245 |
| 512 / communities | After 100 ticks | Unused: exact | 1.065 / 1.335 | 0.250 / 0.232 |
| 8,192 / chain | After 100 ticks | 8 | 1.376 / 1.368 | 3.033 / 3.056 |
| 8,192 / dense communities | Initial | 32 | 1.245 / 1.212 | **Rejected: numerical gate** |
| 8,192 / dense communities | After 100 ticks | 8 | 1.204 / 1.229 | 1.494 / 0.874 |
| 8,192 / star | After 100 ticks | 8 | 1.245 / 1.229 | 0.368 / 0.287 |
| 512 / communities | After 5,000 ticks | Unused: exact | 1.417 / 1.745 | 0.252 / 0.241 |

The three cooled 8,192-point WebGPU cases add roughly **1.2–1.4 ms**, with repeat blocks agreeing closely. Relative to the off control, this is about **29% for chain, 26–27% for dense communities and 12% for star**. Their measured pair ranges are approximately 1.0–1.8 ms; this is a bounded M3 result, not a universal device estimate.

WebGL’s paired samples are much noisier: for example, the cooled dense-community blocks span **−11.30 to +14.37 ms** and **−8.68 to +7.52 ms**, even with valid queries and matching outputs. Its medians are recorded above, but this study does not establish a stable WebGL overhead estimate. The initial dense WebGL controls fail the scalar gates, including 6,080 whole-tick failures in the center-on 32-sample control, and supply no accepted timing summary. Timed-frame failure counts include scalar-output checks as well as anchor replay checks.

The current refined polar center kernel is a correctness reference with a material measured cost. A cheaper Cartesian formulation of the real-arithmetic force is the next optimization candidate; its floating-point behavior must pass these unchanged gates before adopting it. Broader strengths, masks inside complete force composition, other GPUs and full Graph scheduling remain open.

Timings are machine-specific; measurement JSON stays local. The center-off [baseline findings](#/matched-layout/docs/findings) remain separate.

The timing API follows luma’s [query-set model](https://luma.gl/docs/api-reference/core/resources/query-set) and [explicit GPU command model](https://luma.gl/docs/api-guide/gpu/gpu-commands). This lab pins its dependency version; implementation details are checked against that installed version.

## Reproduce

Run `pnpm --filter @cosmos.gl/gpu-lab dev`, open **Matched layout comparison**, select the force setting and graph, then run, probe and measure center cost. Keep the tab visible while timing; use **Stop** to retain a partial report. **Export JSON** includes center settings, aggregate/stage checks, timing preflights, every trial and the first failure. Current independent layouts are left unchanged by timing.

Native regression checks: `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/center`.
