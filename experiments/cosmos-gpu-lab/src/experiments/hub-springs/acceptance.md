The [first hub study](#/hub-springs/docs/findings) found a frozen full-star gain but mixed low-degree results.
This follow-up tests whether the candidate preserves evolving Cosmos layouts, then repeats normal-frame timing
with a configurable hub threshold. Existing reference functions and tolerance constants are unchanged.

## What changes in the candidate

The tile remains 64 neighbors, with sequential correction in the original CSR order. The threshold controls
which directional adjacency lists use that kernel; it does not change the tile size or force law.

Directions with **no qualifying hubs** now dispatch the unchanged plain spring kernel. They skip the degree
check/hoist kernel and the hub dispatch. Directions with hubs still use the guarded low-degree kernel plus the
cooperative hub kernel within the same compute pass. Hub-ID buffers and extra kernels remain allocated even
when the fallback is used; construction/update costs are outside this frame-time study.

The demo starts with threshold 1,024 as a provisional M3 research setting. The baseline remains the default
backend elsewhere in the lab. The original study's timings preceded this fallback and used threshold 64;
its measurements should not be pooled with the new controls.

## Evolving validation

Both variants borrow one device, start from identical graph/input records and evolve independently through
ordinary GPU-resident ticks. They retain their own outputs; neither trajectory resets to CPU positions.
At tick 1, every 10 ticks and the final tick:

1. Compare the two actual tick inputs bit for bit before any reset.
2. Run a normal compute + render frame in each variant and retain its output.
3. Restore that same verified input and replay each force stage for both variants.
4. Check exact baseline/candidate position and force bits at every stage. Compare springs with their original
   absolute `2e−6` + relative `2e−5` CPU budget, and other stages with the original combined budget.
5. Require the normal outputs to match the staged replay exactly and pass the independent whole-tick CPU
   position budget, absolute `2e−5` + relative `3e−5` with exact flags.
6. Restore each variant's own normal output and continue cooling.

After cooling, a full-strength probe runs on the final geometry, passes the same gates and restores the
cooled state. The CPU checks are local to each checked tick/stage; this is not a new independent-CPU
trajectory-drift acceptance criterion. Unchecked ticks have no CPU oracle or position readback.

Failure exports retain stage/input, alpha, seed tick, actual/expected snapshots and the completed gates.
The trajectory stops on failure. A cancelled run preserves partial evidence and releases its resources.

## Why the timing method changed

The initial follow-up still waited for readback/CPU validation after each frame. A degree-1,024 control
using the plain spring kernel in both variants appeared 19.8% faster in one block. That control has no
intended spring optimization. It exposed enough scheduling/clock noise to invalidate a threshold decision
from those small differences. The earlier final-geometry observations (about 11% full strength and 9% cooled)
used that method too, so they are preliminary rather than the final evidence below.

The batched rerun reduces those waits and reports the plain-kernel controls alongside the candidate. It
does not assume that more samples alone remove timing bias.

## Timing method

Only normal frames are timed: four warmup and twelve measured paired rounds, alternating which variant runs
first. Each trial queues four GPU-restored frames without per-frame CPU waits. luma command-buffer copies restore
the frozen input before each compute pass and save that frame’s positions and forces after rendering. Every
saved output is read and validated after the whole batch. The copies, CPU reference work, uploads, readbacks
and temporary allocation are outside the GPU timestamp intervals. Every frame retains the ordinary compute
and render passes. No diagnostic split passes are interleaved in this follow-up. Within-pass timestamp pairs are retained per
frame and summed; no subtraction spans unrelated passes. Temporary freeze/history buffers add 1.125 MiB
at 8,192 points and four frames, and retire after each trial. Copy traffic can affect GPU scheduling/cache
state even though it is outside the reported pass durations, so the plain-kernel controls remain essential.

**Repeat threshold controls** holds the selected degree/pin state fixed and tries thresholds 64, 1,024,
4,096 and 8,192. It repeats them in reverse order in a second block. The 8,192 threshold cannot select a hub
in these 8,192-point broom graphs and provides a plain-kernel control. Every row gets its own warmup, exact
stage replay and unchanged CPU gates. Both variants share one device; resources retire between rows.

**Benchmark final geometry** is enabled only after a passing trajectory. Select either the final cooled
strength or a full-strength restoring probe. These frozen final-state measurements do not report average
frame cost over an evolving trajectory.

## Results on Apple M3

Standalone Chrome 156, luma `10.0.0-alpha.4`, 8,192 points and the same fixed-size broom fixtures.
At cutoff 1,024, all **12 large trajectory cases pass**: degrees 1,024, 4,096 and 8,191, both hub pin states,
and 100/300-tick cooling schedules. That is **2,400 evolving ticks, 264 checkpoints/probes and 1,056 stage gates**.
Every checkpoint preserves exact GPU replay and the unchanged original CPU budgets. Both lanes retire with
zero tracked buffer bytes. These cases use fixed rest lengths, unit weights and the bounded lab force slice.

### Threshold crossover

Each change compares candidate/baseline medians within its own block. Negative is faster. The two blocks
reverse threshold order; the table selects the informative active-kernel and plain-kernel controls from
32 captured rows. A threshold above the hub degree uses the plain fallback.

| Degree | Threshold | Block 1 change | Block 2 change | Paired wins in each block |
| --- | --- | ---: | ---: | --- |
| 256 | 64 | −0.1% | −0.6% | 7/12, 9/12 |
| 256 | 1,024 | +0.3% | +0.3% | 4/12, 5/12 |
| 1,024 | 1,024 | −2.7% | −3.0% | 11/12, 10/12 |
| 1,024 | 4,096 | +0.1% | +0.3% | 6/12, 4/12 |
| 4,096 | 1,024 | −10.5% | −11.1% | 12/12, 12/12 |
| 4,096 | 8,192 | −0.8% | −0.9% | 7/12, 9/12 |
| 8,191 | 1,024 | −10.6% | −13.2% | 12/12, 12/12 |
| 8,191 | 8,192 | +0.5% | −0.4% | 5/12, 9/12 |

Degree 256 shows no convincing benefit. Degree 1,024 has a small repeatable gain, while larger hubs give a
clearer normal-frame improvement. This supports **1,024 as a provisional cutoff on this machine**, not a
universal optimum. The threshold sweep uses unpinned hubs; pinned performance has only the final-star
controls below. Tile size remains 64 throughout.

Most plain-kernel controls stay near baseline. One degree-256/threshold-8,192 block still appears 3.3% faster,
then 0.6% slower in the reverse block. Small percentage differences remain uncertain. The large-hub result
is stronger than the exact crossover location; more hardware and repeated degree distributions are needed
before choosing a production policy.

### Does the gain survive changed geometry and cooling?

Threshold 1,024, degree 8,191. Geometry comes from a passing resident trajectory; the seed tick remains the
trajectory's final tick. Both variants restore exactly that same state for every measured frame.

| Final geometry | Strength | Baseline ms | Prefetch ms | Change | Paired wins |
| --- | --- | ---: | ---: | ---: | ---: |
| Unpinned, after 100 ticks | Full-strength probe | 13.214 | 11.338 | −14.2% | 12/12 |
| Unpinned, after 100 ticks | Cooled, alpha 0.001 | 12.747 | 11.305 | −11.3% | 12/12 |
| Pinned, after 300 ticks | Full-strength probe | 13.050 | 11.395 | −12.7% | 12/12 |
| Pinned, after 300 ticks | Cooled, alpha 0.001 | 13.279 | 11.436 | −13.9% | 12/12 |

All **4,608 captured frames across 36 timing rows**, 144 stage gates and 72 normal anchors pass.
Every timestamp is valid and every retired row reports zero tracked buffer bytes remaining. These are
normal compute + minimal render pass durations; GPU copies and instrumentation traffic remain outside the
reported intervals. They are not full-engine or end-to-end frame budgets.

### Migration implication

The ordered hub path now has a bounded trajectory gate and a measured normal-frame benefit. Keep it opt-in
with a plain fallback for lower degrees. The next large performance target is **hierarchy/grid aggregation**.
Production defaults, randomized rest lengths, large multi-hub distributions, the remaining forces and
renderer, layout-quality criteria and cross-device qualification are still open.

## Reproduce

Open [Ordered hub springs](#/hub-springs), select 8,192 points and threshold 1,024.
Run **Validate trajectory** for 100 or 300 ticks, then **Benchmark final geometry** for each strength.
Use **Repeat threshold controls** at degrees 256, 1,024, 4,096 and 8,191. Keep the tab visible and avoid
competing GPU work. **Export JSON** retains the latest trajectory or timing report; exports stay outside Git.

```sh
# Routine native regression checks.
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/hub-trajectory.test.ts

# Explicit 8,192-point matrix: three degrees × two pin states × two schedules.
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=8192 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/hub-trajectory.test.ts
```
