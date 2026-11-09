# Batched timing: where the grid wins

> Historical measurements of the original serial kernel. The [precision investigation](#/neighborhood-forces/docs/precision)
> fixes its dense-case errors and records the added cost. The timings below do not describe the fixed kernel.

Measured on **9 November 2026**, using the browser's native Apple GPU / Metal 3 adapter, with timestamp
queries enabled. These results measure fixed-radius local repulsion, not Cosmos's global many-body force.

**The grid advantage holds at 4,096 points, but is not general at 1,024. At 65,536 points, a 64×64 grid
is the strongest starting point among the three tested sizes; density and radius still matter.**

Measurements vary by GPU, browser and system load. The findings are recorded here; use the
reproduction steps to collect your own results with the lab’s JSON export. Raw captures are not stored in Git.

## Reproduce the workload

1. Start the lab with `pnpm --filter @cosmos.gl/gpu-lab dev` from the repository root.
2. Open [Neighborhood forces → Demo](#/neighborhood-forces). In **Repeatable parameter sweep**,
   choose **Large**, **2 repetitions**, and order seed **20261109**.
3. Keep the tab visible, run the sweep, and choose **Export sweep JSON**.
4. Repeat with seed **20261110**. Record your GPU, browser, power state and code revision alongside
   the exports. Compare matching validated configurations; do not time failed rows or count skips as passes.

The normal sweep now uses the precision-fixed baseline, so this repeats the workload and measurement
method, not the historical serial kernel or its timings. To compare the preserved original serial
shader with the fix, use **Check dense precision**; see [Precision findings](#/neighborhood-forces/docs/precision).

## Scope and measurement

Two Large sweeps used order seeds **20261109** and **20261110**, each with two repetitions. Each sweep
covers 108 configurations: 1,024 / 4,096 / 16,384 / 65,536 points; density 1× / 4× / 16×; radius
0.04 / 0.08 / 0.16; and grids 16×16 / 32×32 / 64×64. Cell widths are 0.125 / 0.0625 / 0.03125 in a
fixed [−1, 1]² domain. Uniform coordinates are compressed by sqrt(density).

Across **864 scheduled method rows**, **643 passed**, **216 were explicitly skipped** because all-pairs
is capped at 4,096, and **5 failed validation**. Larger datasets use 128 deterministic CPU reference
points, with every output checked for non-finite values. A passed row is not exhaustive validation.

Every stage calibrates a batch targeting 4 ms, capped at 64 operations, then records eight batches after
two warm-ups. Reported GPU times divide the timestamp interval by the number of operations in that
batch. Inputs stay frozen, and rendering uses a detached 480×480 canvas. This measures repeated GPU
work, not interactive frame rate or presentation cost. Expensive stages use one operation per batch.
See [Performance](#/neighborhood-forces/docs/performance) for exact timing boundaries.

The sweeps ran at 08:04–08:07 and 08:08–08:11 UTC. Development checks briefly overlapped the beginning
of the first sweep; the second ran after they finished. Power state, temperature and other system load
were not controlled. The exact chip model was not exposed by the adapter metadata.

## Does the grid advantage hold?

Pair each grid row with all-pairs for the same count, density, radius, grid size, repetition and sweep.
The ratio is **all-pairs GPU tick p50 / grid GPU tick p50**. Greater than one favors the grid. These are
medians of paired ratios, not ratios of pooled timings, confidence intervals or a prediction for other devices.

| Points | Grid wins | Ties | All-pairs wins | Median paired ratio |
| --- | ---: | ---: | ---: | ---: |
| 1,024 | 45 / 108 | 1 | 62 | 0.943× |
| 4,096 | 96 / 108 | 0 | 12 | 3.126× |

The independent order shuffles agree: 4,096-point median ratios were **3.148×** and **3.074×**;
1,024-point ratios were **0.945×** and **0.933×**. Grid construction and traversal overhead can outweigh
saved distance tests at small counts. Dense neighborhoods and large radii also reduce the benefit.
There is **no measured all-pairs comparison above 4,096 points** in this study.

## Which cell size works best?

For each count/density/radius, take the median of its four row-level GPU tick medians for each grid.
Only configurations with all four repetitions passing for all three grids enter this ranking.

| Points | Lowest median: 16×16 | Lowest median: 32×32 | Lowest median: 64×64 |
| --- | ---: | ---: | ---: |
| 1,024 | 0 | 5 | 4 |
| 4,096 | 2 | 4 | 3 |
| 16,384 | 0 | 5 | 4 |
| 65,536 | 0 | 1 | 7 |

These are descriptive rankings, not statistically established winners. Several smaller cases vary
substantially across repetitions, and small differences should be treated as unresolved. At 65,536,
the 64×64 result is more consistent: it leads seven of eight fully validated scenarios. The exception
is density 16× / radius 0.04, where 32×32 gives **34.05 ms** versus **36.08 ms** for 64×64.

Smaller cells reduce candidate checks but increase cell traversal. The best size is therefore not
always the smallest available. These are only three tested sizes; the sweep does not establish a global optimum.

### Full grid comparison

Values below are **GPU milliseconds per complete tick**, median of four row medians. This includes
rendering. A dash means at least one repetition failed; no winner is selected for that scenario.

| Points | Density | Radius | 16×16 · width 0.125 | 32×32 · width 0.0625 | 64×64 · width 0.03125 |
| --- | --- | --- | ---: | ---: | ---: |
| 1,024 | 1× | 0.04 | 0.221 | 0.256 | 0.197 |
| 1,024 | 1× | 0.08 | 0.257 | 0.143 | 0.224 |
| 1,024 | 1× | 0.16 | 0.160 | 0.146 | 0.168 |
| 1,024 | 4× | 0.04 | 0.147 | 0.131 | 0.136 |
| 1,024 | 4× | 0.08 | 0.297 | 0.174 | 0.264 |
| 1,024 | 4× | 0.16 | 0.371 | 0.335 | 0.228 |
| 1,024 | 16× | 0.04 | 0.394 | 0.201 | 0.192 |
| 1,024 | 16× | 0.08 | 0.164 | 0.161 | 0.437 |
| 1,024 | 16× | 0.16 | 0.375 | 0.781 | 0.317 |
| 4,096 | 1× | 0.04 | 0.364 | 0.247 | 0.253 |
| 4,096 | 1× | 0.08 | 0.354 | 0.206 | 0.212 |
| 4,096 | 1× | 0.16 | 0.177 | 0.181 | 0.506 |
| 4,096 | 4× | 0.04 | 0.587 | 0.300 | 0.285 |
| 4,096 | 4× | 0.08 | 0.202 | 0.393 | 0.368 |
| 4,096 | 4× | 0.16 | 0.500 | 0.337 | 0.866 |
| 4,096 | 16× | 0.04 | 1.638 | 0.498 | 0.429 |
| 4,096 | 16× | 0.08 | 0.608 | 1.737 | 0.310 |
| 4,096 | 16× | 0.16 | 5.276 | 1.384 | 2.337 |
| 16,384 | 1× | 0.04 | 0.595 | 0.378 | 0.863 |
| 16,384 | 1× | 0.08 | 1.174 | 0.620 | 0.393 |
| 16,384 | 1× | 0.16 | 2.097 | 0.950 | 1.016 |
| 16,384 | 4× | 0.04 | 2.146 | 0.786 | 0.606 |
| 16,384 | 4× | 0.08 | 2.130 | 1.622 | 2.146 |
| 16,384 | 4× | 0.16 | 4.915 | 4.030 | 4.162 |
| 16,384 | 16× | 0.04 | 4.948 | 2.687 | 1.360 |
| 16,384 | 16× | 0.08 | 4.882 | 6.652 | 4.162 |
| 16,384 | 16× | 0.16 | 13.402 | 6.881 | 6.947 |
| 65,536 | 1× | 0.04 | 13.369 | 4.784 | 3.670 |
| 65,536 | 1× | 0.08 | 13.500 | 11.567 | 6.521 |
| 65,536 | 1× | 0.16 | 33.227 | 20.677 | 19.202 |
| 65,536 | 4× | 0.04 | 33.096 | 13.795 | 11.862 |
| 65,536 | 4× | 0.08 | 34.177 | 35.324 | 21.660 |
| 65,536 | 4× | 0.16 | 81.658 | 64.946 | 62.882 |
| 65,536 | 16× | 0.04 | 73.466 | 34.046 | 36.078 |
| 65,536 | 16× | 0.08 | 74.711 | 80.019 | 64.782 |
| 65,536 | 16× | 0.16 | — | 144.343 | — |

## What dominates at larger counts?

For 65,536 points, density 1×, radius 0.04, grid 64×64, standalone median timings were approximately
**0.091 ms grid build**, **3.015 ms force traversal**, **0.019 ms integration**, and **0.426 ms rendering**.
Complete-tick time was **3.670 ms**. Standalone stage medians must not be summed to predict tick time.

At density 4× / radius 0.08 on that same grid, force traversal rose to **21.037 ms**, while grid build
remained about **0.090 ms**. Complete-tick time rose to **21.660 ms**. This points to neighbor traversal
and its memory access as the main optimization target at scale, rather than only the count/scan/scatter build.

## Precision improved, but batching is not noise removal

Of **23,992 recorded GPU intervals**, **18 were zero** (0.075%), all from integration. No interval was
invalid. The median whole-batch interval was **3.277 ms**. The earlier quick, single-operation sweep had
42% zero intervals; it used a smaller parameter matrix, so this is not a controlled same-workload comparison.
Batching greatly reduces the short-interval problem, but clocks, caches, scheduling and run order still
influence results. New sweep exports include raw timestamp intervals, calibration, batch sizes and normalized samples.

## The dense-case validation failure

All five failures were at **65,536 points, density 16×, radius 0.16**: three with grid 16×16 and two with
64×64. They involved **one or two sampled force vectors per row** exceeding the existing mixed tolerance.
Neighbor counts matched exactly for all checked points, no non-finite values appeared, and integrated
position/velocity errors stayed within their limits. Maximum force error in the failed rows was about
**0.00113–0.00152**. Each point had about **15,740 actual neighbors** on average.

This is consistent with floating-point accumulation order and cancellation after many contributions,
but the cause is not yet isolated. Scatter order is unspecified, and the pass/fail result changed between
repetitions. **The tolerance was not relaxed, failed rows were not timed, and this scenario was excluded
from cell-size ranking.** It needs a dedicated precision investigation before treating it as validated.

## Working decision

- Keep tiled all-pairs as a small-data baseline; there is no universal grid win at 1,024 points.
- Use 64×64 as the next starting configuration for large populations on this device, and retain 32×32
  as a candidate for dense/small-radius cases. Do not hard-code a universal cell size from this study.
- Compare spatially reordered positions or another way to improve neighbor-read locality next.
- Investigate stable accumulation separately on the dense case, retaining the current validation threshold.
- Repeat on other hardware and with evolving simulation inputs before choosing production defaults.
