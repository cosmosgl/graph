# Exact collision: retaining the center sum fixes the dense case

**A GPU-resident high/low center reduction fixes the observed dense four-pass WebGPU failure at unchanged tolerance. The corrected 512-point run passes all 100 ticks, with zero center aggregate, force and position error. The production WebGL control retains its separate failures; complete backend parity is not established.**

Measured **12 November 2026** on Apple M3 in **Codex’s inline browser, Chromium 157**, with luma `10.0.0-alpha.4`. Native regression checks also run separately in installed Chrome. These are bounded single-device findings, not a support-matrix claim.

**Follow-up:** [Independent collision layouts](#/collision/docs/trajectories) now tests each backend’s own evolving history. It records 1,700 ticks per GPU, accumulated drift, cooled geometry and a new native-collision whole-tick failure. The shared-input center-correction evidence below remains separate.

## Original float32-tree baseline

The following matrix and collision-cost table use the original **float32 center tree**. They remain baseline evidence, rather than measurements of the corrected default described below. Select that original control under the demo’s advanced settings to reproduce them.

Every row below covers 100 ticks, checked at every tick. Both GPUs start each tick from the shared CPU state. The CPU then evolves to the next state; this is not an independent-trajectory drift study. Strength is 1, padding 0.25, radius is size / 2, alpha is fixed at 1 and collision cooling is 0. Combined mode uses gravity, center attraction 1, exact repulsion, production spring variation and the collision contact-distance floor.

| Points / fixture | Workload | Collision passes | WebGPU collision kernel | WebGL passes | WebGPU passes |
| --- | --- | --- | --- | --- | --- |
| 128 / uniform | Isolated collision | 1 | Native f32 | 100 / 100 | 100 / 100 |
| 128 / uniform | Isolated collision | 1 | Strict reference | 100 / 100 | 100 / 100 |
| 128 / uniform | Combined | 1 | Native f32 | 100 / 100 | 100 / 100 |
| 512 / dense clusters | Isolated collision | 1 | Native f32 | 100 / 100 | 100 / 100 |
| 512 / dense clusters | Combined | 1 | Native f32 | 98 / 100 | 100 / 100 |
| 512 / dense clusters | Combined | 4 | Native f32 | 99 / 100 | 99 / 100 |
| 128 / coincident stack | Isolated collision | 1 | Native f32 | 100 / 100 | 100 / 100 |
| 8 / pins and absence | Combined | 1 | Native f32 | 100 / 100 | 100 / 100 |

Across these eight comparisons, WebGPU passes **799 / 800** tick gates and WebGL **797 / 800**. The native-f32 subset is **699 / 700** for WebGPU; its strict isolated reference contributes the other 100 passing ticks. All cases retain the original force/position budgets. The first failure in each of the three failing API/run combinations reproduces with identical output bits and verified position restoration.

Native tests additionally cover fixed-radius overrides, padding, cooling exponents 0 / 0.5 / 1 / 2 at alpha 0 / 0.01 / 1, and a coincidence at index 4,095. That last case has only two present points: it checks index/radius/mask semantics at the exact-path boundary, not dense 4,096-point performance.

## The dense failure is inherited through center precision

At 512 dense points with one collision pass, WebGL fails one whole-tick coordinate at tick 1 and 48 center-force components at tick 38. WebGPU passes all 100 ticks.

With four passes, WebGL fails 148 whole-tick components at tick 1. WebGPU fails **3 whole-tick position components at tick 2**, with maximum error **0.16552734375**. All its local stage gates pass. Repeating that tick with the **strict collision kernel** still fails the whole-tick gate; the collision-native arithmetic is not the sole cause.

The first local discrepancy in that WebGPU tick is the center reduction: the Y sum differs by **0.125**, and the center-stage positions differ by **0.000244140625**, a [one-ULP](#/vocabulary/ulp) step near 2,048. Subsequent forces and collision passes amplify the changed intermediate state.

A targeted native diagnostic replaces **only the post-center GPU positions** with the CPU center-stage output, keeping the same force settings and every remaining GPU stage. The whole tick then passes for both collision kernels. This localizes the observed sensitivity to the center intermediate in this fixture. It is a diagnostic replay with a CPU upload, **not a resident-path fix or a proposed production fallback**.

Passing each local force gate is insufficient to infer whole-tick agreement. The original failure remains visible and exportable using **Center reduction (WebGPU) → Float32 tree · original control**.

## GPU-resident correction

The CPU sums stored float32 positions in JavaScript double precision, then rounds the completed aggregate to float32 once. The original GPU tree rounds each intermediate addition to float32. A small early rounding error can cross a later collision boundary and become a much larger whole-tick difference.

The corrected tree carries each X/Y sum as two floats: a high part and its residual. It uses the pinned luma module’s integer-controlled `sum_fp64`, retaining both parts through every reduction dispatch. Only the last workgroup writes the high part into the existing float32 sum/count buffer. Count uses integer addition. The center division, polar force, integration, collision kernels, CPU reference and **all tolerance constants stay unchanged**.

```flow
Present GPU positions · exclude absent NaNs; include pins
256-invocation high/low reduction · keep the residual at every level
One float32 aggregate · round the completed sum once
Unchanged center force and integration
Unchanged repulsion, springs and four collision passes
```

There is no CPU centroid upload or normal-frame readback. Dispatch count and asymptotic work stay the same. Each partial grows from 16 to 32 bytes and workgroup scratch from 4 to 8 KiB. Both reduction variants are allocated before timing; switching controls changes only the GPU reduction path. This is approximately 48-bit double-single arithmetic within float32’s exponent range, **not an IEEE binary64 replacement or a universal exact-sum guarantee**. See [luma’s arithmetic contract](https://luma.gl/docs/api-reference/shaders/shader-modules/fp64-arithmetic). The exact aggregate assertions below cover the tested stored-position envelope.

### Verification on M3

Each row is a new inline-browser run with the same fixture, force settings, alpha, CPU trajectory and budgets as its control:

| Fixture / workload | Center sum | WebGL ticks pass | WebGPU ticks pass | Maximum WebGPU center error: aggregate / force / position |
| --- | --- | --- | --- | --- |
| 512 dense / combined, 4 collision passes | Original float32 tree | 99 / 100 | **99 / 100** | Nonzero; tick-2 whole gate fails |
| 512 dense / combined, 4 collision passes | High/low | 99 / 100 | **100 / 100** | **0 / 0 / 0** |
| 512 dense / combined, 1 collision pass | High/low | 98 / 100 | **100 / 100** | **0 / 0 / 0** |
| 8 pinned/absent / combined, 4 collision passes | High/low | 100 / 100 | **100 / 100** | **0 / 0 / 0** |

The original control reproduces tick 2’s three failures and maximum error 0.16552734375. The corrected dense run’s maximum whole-tick position error is **0.002685546875**, within the original budget; whole ticks are not claimed bit-identical. Native regression checks independently pass that failing tick with both native and strict collision kernels **without replacing any CPU intermediate**.

Aggregate bit checks cover counts 1, 255, 256, 257, 4,097, 8,192 and 65,537, followed by shrink to 4. They exercise positive world offsets, signed cancellation, pins, mixed absent NaNs, all-absent inputs and repeated reductions. The 65,537-point case requires three reduction dispatches. Existing center-resource tests also cover empty input and regrowth. The focused collision/combined suite passes **84 tests**.

### Cost of retaining the residual

**Compare center precision cost** holds collision enabled in both controls, including all four passes and the spring floor. It alternates original float32 / high-low on one WebGPU backend, freezes the initial 512-point dense geometry, and measures complete ordinary compute + drawing frames. The force kernels and camera remain the same. This is separate from collision off/on timing below.

| Block | Float32 frame ms | High/low frame ms | Median paired added ms | Pair range ms |
| --- | --- | --- | --- | --- |
| 1 | 3.588 | 3.703 | 0.074 | −0.115 … +0.360 |
| 2 | 3.678 | 3.777 | 0.098 | −0.246 … +0.410 |

Both scalar preflights, all **256 captured frames**, exact GPU-anchor replays, unchanged whole-tick budgets and timestamp queries pass. Median added cost is about **2.1–2.7%** of the original frame, but the ranges cross zero: this is a noisy small-overhead estimate, not a stable kernel-cost claim. Both controls must pass; timing the known failing tick-2 input cannot produce an accepted comparison. Raw trials remain available through local JSON export.

## Resolving overlap is a separate question

After 100 ticks, isolated uniform collision at 128 points has maximum penetration **0.000319** world units. It still reports 67 strictly positive overlaps, comparable to float32 position spacing around this world frame. The raw geometric count uses no hidden tolerance.

Dense cases remain materially overlapped. At 512 clustered points in combined mode, four passes reduce CPU maximum penetration from **4.9433 → 2.9839** units, while the number of overlapping pairs changes **605 → 659**. More passes do not establish a non-overlapping layout or a universal quality improvement. The constraint’s relaxation, per-pass cap and the other forces’ continuous compression all matter.

The masked fixture retains one overlapping pair of pinned discs, which cannot separate. Collision checks still validate zero corrections for absent points, preservation of pin/absence flags and the unchanged present-point force budgets. Unused absent-target spring corrections follow the [documented validation domain](#/collision/docs/method).

## Original baseline: added collision GPU cost

Each value below is a block’s median paired **on − off milliseconds per frame**. Both controls use one shared camera that fits full disc radii and their preflight outputs. Measurements freeze the **initial geometry** at alpha 1. Two blocks use four warmup pairs and twelve measured pairs each; WebGPU batches four frames per observation, while WebGL times one.

| Points / fixture | Workload / passes | WebGPU kernel | WebGPU added ms, blocks 1 / 2 | WebGL added ms, blocks 1 / 2 |
| --- | --- | --- | --- | --- |
| 128 / uniform | Isolated / 1 | Native f32 | 0.164 / 0.147 | 0.226 / 0.234 |
| 128 / uniform | Isolated / 1 | Strict reference | 5.718 / 5.751 | 0.229 / 0.232 |
| 128 / uniform | Combined / 1 | Native f32 | 0.123 / 0.279 | 0.249 / 0.214 |
| 512 / dense clusters | Isolated / 1 | Native f32 | 0.041 / 0.008 · noise dominated | 0.964 / 1.245 |
| 512 / dense clusters | Combined / 1 | Native f32 | 0.213 / 0.164 | **Rejected: numerical gate** |
| 512 / dense clusters | Combined / 4 | Native f32 | **0.934 / 0.836** | **Rejected: numerical gate** |

The strict reference’s roughly **5.7 ms** overhead at 128 points comes from explicit arithmetic inside an all-pairs loop. It is useful as a correctness control, not the proposed fast collision kernel. The native force kernel makes a substantially cheaper implementation plausible on this device while retaining the same numerical gates.

The clearest larger added-cost signal is four passes at 512 dense points: **0.84–0.93 ms**, about **32–33%** of the off control. All pair differences are positive in those two blocks, spanning **0.524–1.409 ms** and **0.705–1.196 ms**. This accepted timing applies to the initial frozen controls, not the later failing tick-2 state.

Single-pass estimates are less stable. In isolated dense WebGPU, pair differences span **−2.376 to +1.016 ms** and **−0.508 to +1.065 ms**, despite valid output/timer checks. Near-zero medians do **not** establish free collision or a negative kernel cost. These full-frame deltas include drawing-work changes from the corrected positions. WebGL’s immediate command stream is also noisy: its uniform isolated pair ranges span several milliseconds, much wider than their median added cost. Do not infer a universal cross-API speed ratio from this table.

All **1,536 captured WebGPU timing frames** pass their validated anchor and whole-position checks; all queries are valid. The two dense combined WebGL on-controls fail CPU preflight and supply no accepted timing summary. Their 64 failing captured frames remain in local JSON. Numerical/query acceptance and statistical stability are separate.

## Reproduce and next acceptance evidence

Run the [demo](#/collision), choose **clusters / 512 / Combined forces / 4 passes**, and leave **High/low sum · corrected** selected in the advanced settings. Run 100 ticks. The center precision table reports the maximum errors across the run. Select the original float32 tree to replay the failing control. Use native or strict collision arithmetic; the targeted native test checks both.

Reset to tick 0 and choose **Compare center precision cost** for the correction’s paired frame comparison. **Measure added GPU cost** remains the separate collision off/on comparison using the selected center reduction. Export JSON for local analysis; measurement captures are machine-specific and are not committed. Replay failures retains the original controls’ evidence.

Run `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision src/experiments/combined-layout/center` for collision and center regression checks. `composition.test.ts` retains the original CPU-splice diagnostic, then requires the resident correction to pass without that splice. `center-reduction.test.ts` checks aggregate bits across reduction boundaries; `center-reduction-cost.test.ts` checks accepted/rejected control timing.

The independent trajectory study is now recorded [separately](#/collision/docs/trajectories): center remains locally exact in its tested envelope, while accumulated coordinates diverge and one cooled native-collision tick fails composition. The next evidence is a focused collision-arithmetic correction and larger collision workloads. The spatial-hash/slot production path above 4,096 points, broader coordinate ranges/data/weights, dynamic updates, native portability and a complete Graph integration remain unvalidated. Earlier long-run center drift and timings used the original float32 tree; this correction does not retroactively change those measurements.
