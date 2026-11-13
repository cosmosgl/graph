This follows the [controlled GPU profile](#/gpu-stage-profile/docs/method) and
[ordered hub study](#/hub-springs/docs/acceptance). It targets hierarchy aggregation with the same
source-index accumulation order, original CPU budgets and strict reference output bits.

## Reuse integer membership

Binning calculates every present point's cell at every hierarchy level and inserts it into a linked list.
Aggregation traverses each list and sorts up to 128 source indices before summing. A crowded cell instead
scans every source in ascending index order and calculates its cell again.

The cache-only candidate saves those integer cell IDs during binning. Crowded cells test the cached ID, then add the
same sources in the same order. Absent points get an empty key every tick. Sparse sorting, sample selection,
centroids and every floating-point addition stay unchanged. Storage adds one `uint32` per point per level:
192 KiB at 8,192 points and six levels. There is no extra dispatch.

The second candidate keeps that cache and reduces the per-invocation index array from 128 to 32 entries.
It sorts cells of up to 32 members; once a linked list reaches its 33rd member, classification can stop and
use the ascending-source scan. The full occupancy is still computed by the sum's count channel. Both paths
add exactly the same sources in the same order, so this changes integer work and scheduling, not reduction
arithmetic. More cells now scan all source IDs: this is a tradeoff, not an automatic speedup.

```flow
GPU bounds · Same coordinates and jitter
Bin · Save membership alongside the existing linked lists
Aggregate · Same ordered sum; crowded cells reuse cell IDs
Samples and centroids · Same inputs and rounded values
Forces, integration and drawing · Same ordinary frame
```

The dense full-source scan and sparse insertion sort remain. This is a bounded optimization of the existing
builder, not a scalable CSR constructor or parallel floating-point reduction.

## Controls and gates

Both variants borrow one luma device. All other kernels use the strict composed gravity, global repulsion,
springs and cooling candidate. Spring scheduling is held at its existing baseline in both variants. Point 0
is pinned and point 1 is absent, with finite stored coordinates. Shape changes coordinates; topology stays
chain or communities. Optional 20-tick preparation advances both variants with exact replay and original
whole-tick CPU checks before freezing input, alpha and seed.

The occupancy table uses the actual post-gravity input. It reports empty and occupied cells, maximum
occupancy, cells above the 128-source cutoff and dense source tests. These are exact workload counts, not
GPU cycle measurements. Aggregate, slot, centroid and bounds bits must match across variants. Aggregates
and centroids must also match independently constructed CPU values exactly.

Every force stage passes its original CPU budget, including the tighter spring checks. Normal anchors,
every timed frame and diagnostic replay must match staged output bits and the original whole-tick CPU
position budget. A failed baseline gate stays visible and stops timing for that case. Independent cases continue, but the
report retains failed status. No tolerance changes.

## Timing

Primary: ordinary compute + minimal render GPU time. Four warmup and twelve measured paired rounds alternate
variant order. Each normal trial queues four GPU-restored frames and validates every captured output after
the batch. Copies, allocation, readback and CPU work stay outside timestamp endpoints. This reuses the
[GPU-batched method](#/hub-springs/docs/acceptance), with its instrumentation limits.

Diagnostic profiles run afterward in a separate phase, with one pass per stage and paired order. Bin and
aggregate durations help locate the effect. The split-pass sum is not a decomposition of a normal frame;
a faster isolated aggregate pass must improve normal frames too. Zero diagnostic durations can mean work
below timestamp resolution; they do not mean free work. **Duplicate baseline** measures variation
when both variants run the same implementation.

JSON export retains frozen inputs, raw frames, occupancy, gates, memory and partial results. Exports stay
outside Git. Buffers retire between cases; reset and navigation retire the owner device.

## Reproduce

Open [Ordered grid aggregation](#/cell-aggregation). Compare cached membership with its duplicate-baseline
control. **Repeat size + density sweep** tries 4,096/8,192 points and uniform/two-cluster positions in reverse
case order across two blocks. Repeat for chain and communities, then try the 20-tick prepared state.
Keep the tab visible and avoid competing GPU work.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/aggregation.test.ts src/experiments/combined-layout/grid-study.test.ts
```

## Findings on Apple M3

Standalone Chrome 156, luma `10.0.0-alpha.4`. These results use the lab's composed strict force slice and
minimal renderer, not the complete production engine or its default schedule. Change is candidate/baseline
median GPU time within one matched block; negative is faster.

### Caching alone was insufficient

The 128-index cache-only probe gave **5.218 → 5.218 ms** on the uniform 8,192-point chain, with 5/12 paired
wins. Its diagnostic aggregate median changed only 1.933 → 1.835 ms. The dense probe was slower overall,
4.325 → 4.932 ms, despite exact outputs. These are initial probes, not a reason to enable that variant.

### Bound the sorting work as well

The 32-index candidate combines membership reuse, a smaller declared index array and early termination of
crowded linked-list classification. Their individual hardware contributions have not been isolated.

| Graph and positions | Points | Block 1 change | Block 2 change | Paired wins, blocks 1 / 2 |
| --- | ---: | ---: | ---: | --- |
| Chain, uniform | 4,096 | +4.1% | +2.8% | 5/12, 4/12 |
| Chain, two clusters | 4,096 | −22.2% | −25.2% | 12/12, 12/12 |
| Chain, uniform | 8,192 | −12.3% | −12.6% | 11/12, 11/12 |
| Chain, two clusters | 8,192 | −16.9% | −8.5% | 12/12, 12/12 |
| Communities, uniform | 4,096 | +2.4% | +4.4% | 5/12, 3/12 |
| Communities, uniform | 8,192 | −15.1% | −12.9% | 12/12, 12/12 |
| Communities, two clusters | 4,096 / 8,192 | CPU gate blocked | CPU gate blocked | No timing accepted |

The 8,192-point uniform chain changes **5.267 → 4.620 ms** and **5.284 → 4.620 ms**. Diagnostic aggregation
falls from 1.966/1.933 ms to 1.245 ms in both blocks. Binning, sampling and far-field diagnostics are mostly
unchanged or near timer resolution. These are separate measurements, not a subtraction-based decomposition.

The smaller uniform controls show no benefit and appear slower. Their baseline has no cells above 128
members, while the candidate switches 58 cells to a full-source scan: **0 → 237,568** source tests. At 8,192
uniform points, 36 cells already use the baseline scan, costing 294,912 source tests. The candidate changes
where work occurs rather than eliminating the scan. This explains a workload tradeoff; it is not a measured
GPU instruction or register-spill attribution.

Production Cosmos currently uses exact all-pairs repulsion at **4,096 points and below**. These smaller
hierarchy cases are deliberate lab controls and do not measure that production route.

### Duplicate-baseline controls

On uniform 8,192-point inputs, the identical-implementation control changes −0.9% and +0.5%, versus roughly
12–15% for the candidate. Other control blocks still reach −3.2% and −4.4%; small changes remain uncertain.
Atomic insertion order can alter sorting work even though the final source-index sum is deterministic.
The repeated large gains are stronger evidence than the precise magnitude of a small regression.

### Prepared geometry

After 20 naturally evolving, CPU-checked preparation ticks, alpha is about 0.251. Both variants then freeze
that geometry and seed 20 for the measured next frame. These are not average trajectory frame times.

| Prepared 8,192-point graph | Baseline ms | Candidate ms | Change | Paired wins |
| --- | ---: | ---: | ---: | ---: |
| Communities, uniform | 5.243 | 4.571 | −12.8% | 12/12 |
| Chain, two clusters | 5.259 | 4.858 | −7.6% | 12/12 |

All 80 per-variant preparation checks pass. The main matrix contains **26 candidate/control rows**:
**22 accepted timing rows** and **4 blocked rows**. All **2,816 normal-frame captures, 704 diagnostic replays,
104 local stage gates and 44 anchors** pass their applicable unchanged checks. All accepted timers are valid,
all cross-variant grid/force/position comparisons are exact bits, and every case retires with zero tracked
buffer bytes remaining. The four blocked rows never enter timing.

### A baseline acceptance gap remains visible

Clustered communities at both sizes pass all local stages and produce identical baseline/candidate bits,
including aggregates, slots and centroids. The independent whole-tick CPU gate fails: three components at
4,096 points and two at 8,192. Both blocks reproduce it; a duplicate-baseline run confirms the larger failure
without either optimization. This is a gap in the existing composed reference path, not a changed aggregate.

For example, point 2,565's y coordinate at 4,096 points is 0.5248184204 on the GPU versus 0.5248718262 on the
CPU. Error **0.00005341** exceeds the unchanged budget **0.00003575**. Local stage tolerances do not establish
whole-tick acceptance. Exports preserve the input and actual/expected positions for replay; this study does
not resolve the existing composition discrepancy or loosen its gate.

## Migration decision

Keep both candidates opt-in. The 32-index variant has useful normal-frame gains in the validated larger
cases, with **80 KiB / 192 KiB** extra application buffer storage at 4,096 / 8,192 points and no extra dispatch.
It retains dense full-source scans and does not establish million-point layout scalability. The small
uniform tradeoff, baseline composition gap, default-length schedules and cross-device behavior remain open.

A more scalable next design would sort **integer cell/source-ID pairs** into stable CSR membership, then
fold each cell's positions in ascending source order. A bottom-up floating-point reduction cannot be assumed
to reproduce this order. This is an implementation direction to test, not an established performance result.
[NVIDIA's scan chapter](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda)
explains scan as a building block for radix sorting; [luma's current upstream notes](https://github.com/visgl/luma.gl/blob/master/docs/whats-new.md)
describe scan, binning, aggregation and sort primitives. Their API compatibility with this pinned alpha and
Cosmos's accumulation contract would need separate validation before adoption.

## Follow-up: composed acceptance

The [production layout gates](#/layout-acceptance/docs/findings) resolve the
clustered-community whole-tick blocker reported in this study. The first difference was
in near-field repulsion; all far levels already matched. Refined roots/divisions
and explicitly rounded products now pass the original budget. Combining cached
aggregation with hub prefetch also passes selected 8,192-point 100/300-tick
trajectories twice, with roughly 10–19% lower normal-frame GPU time on M3.
The earlier measurements on this page describe the aggregation-only controls.
