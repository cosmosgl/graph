# Exact collision: a checked force, with a composition limit

**The production all-pairs collision law has a working luma WebGPU translation. Native float32 arithmetic passes the isolated cases and selected compositions without changing tolerance. Dense composition with four collision passes exposes an upstream center-precision sensitivity, so complete collision-enabled backend parity is not established.**

Measured **12 November 2026** on Apple M3 in **Codex’s inline browser, Chromium 157**, with luma `10.0.0-alpha.4`. Native regression checks also run separately in installed Chrome. These are bounded single-device findings, not a support-matrix claim.

## Numerical comparison

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

The normal demo and all reported timings retain GPU-resident center reduction and collision. The failing dense cases remain visible and exportable. A precision/acceptance policy for composed forces is still required; passing each local force gate is insufficient to infer whole-tick agreement.

## Resolving overlap is a separate question

After 100 ticks, isolated uniform collision at 128 points has maximum penetration **0.000319** world units. It still reports 67 strictly positive overlaps, comparable to float32 position spacing around this world frame. The raw geometric count uses no hidden tolerance.

Dense cases remain materially overlapped. At 512 clustered points in combined mode, four passes reduce CPU maximum penetration from **4.9433 → 2.9839** units, while the number of overlapping pairs changes **605 → 659**. More passes do not establish a non-overlapping layout or a universal quality improvement. The constraint’s relaxation, per-pass cap and the other forces’ continuous compression all matter.

The masked fixture retains one overlapping pair of pinned discs, which cannot separate. Collision checks still validate zero corrections for absent points, preservation of pin/absence flags and the unchanged present-point force budgets. Unused absent-target spring corrections follow the [documented validation domain](#/collision/docs/method).

## Added GPU cost

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

Run the [demo](#/collision), choose the fixture, count, workload, collision arithmetic and pass count, then measure cost **before advancing the initial state**. Run 100 ticks and replay any failures. Export JSON for local analysis; measurement captures are machine-specific and are not committed.

Run `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision` for the bounded native regression suite. The center-intermediate diagnostic is in `composition.test.ts`; it preserves the tolerance and does not change the ordinary GPU path.

The next evidence is a GPU-resident response to dense center sensitivity, independently evolving collision-enabled trajectories, and larger collision workloads. The spatial-hash/slot production path above 4,096 points, arbitrary data/weights, dynamic updates, native portability and a complete Graph integration remain unvalidated.
