# Reducing the cost of the precision fix

**Chunked traversal helps dense workloads, but is not a universal replacement.** On the native
Apple / Metal 3 GPU, it reduced complete dense ticks by **23% on 16×16** and **8% on 32×32**.
The smaller 4,096-point case slowed down by **14–15%** on those grids. The baseline remains the
lab default; choose **Grid force loop → Chunked** to try the candidate in the demo and Benchmark.
The regular parameter sweep still uses the baseline. Neither variant changes the precision tolerance.

All **72/72 initial checks and 18/18 evolved checks passed**. The candidate's worst force error used
**20.7% of its allowed tolerance** across those checks (baseline: 26.2%). Neighbor counts matched
exactly at every checked target, and all outputs were finite. At 65,536 points, each validation checks
1,148 targets; at 4,096 it checks 1,118.

Measurements vary by GPU, browser and system load. The findings are recorded here; use the
reproduction steps to collect your own results with the lab’s JSON export. Raw captures are not stored in Git.

## Measured result

These are GPU milliseconds per operation, measured on one native Apple / Metal 3 adapter with
Chrome 156 and timestamp queries. Positive savings mean the candidate is faster; negative values
mean it is slower. The comparison completed without invalid timestamp samples.

| Scenario | Grid | Baseline force ms | Chunked force ms | Paired force savings | Baseline tick ms | Chunked tick ms | Paired tick savings |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dense | 16×16 | 306.184 | 231.866 | +24.5% | 306.774 | 235.995 | +23.3% |
| Dense | 32×32 | 169.673 | 154.960 | +8.7% | 169.804 | 156.140 | +8.4% |
| Dense | 64×64 | 177.766 | 175.210 | +1.6% | 179.634 | 175.505 | +2.4% |
| Sparse | 16×16 | 13.730 | 13.402 | +1.9% | 14.352 | 14.057 | +1.8% |
| Sparse | 32×32 | 4.162 | 3.932 | +5.5% | 4.784 | 4.588 | +4.1% |
| Sparse | 64×64 | 3.146 | 3.113 | +1.0% | 3.801 | 3.801 | +0.0% |
| Small | 16×16 | 0.200 | 0.232 | -16.1% | 0.245 | 0.284 | -15.0% |
| Small | 32×32 | 0.170 | 0.203 | -19.2% | 0.221 | 0.252 | -14.4% |
| Small | 64×64 | 0.122 | 0.120 | +0.9% | 0.174 | 0.175 | +0.0% |

Dense 16×16 force savings were **23.8–25.2%** across the four pairs; dense 32×32 savings were
**8.0–11.4%**. Dense 64×64 force savings ranged from **−0.8% to +4.7%**, so the small average gain
is much less compelling. **32×32 remains the fastest grid in this dense fixture**, despite the larger
percentage improvement on 16×16. A 156 ms dense tick is still too slow for an interactive simulation.

For sparse 64×64, three pairs were approximately tied, but one candidate run was **55% slower in
force and 59% slower in tick**. This slower run was included in the comparison, not discarded. The next baseline run
also began slowly before recovering; temporary device load is plausible, but this run does not
establish the cause. We do not claim a reliable gain for that configuration.

The small-case regression is consistent across repetitions: 16×16 ticks were 12–16% slower and
32×32 ticks were 10–16% slower. The extra chunk-loop setup is a plausible cost when cell lists are
short; this explanation is an inference, not a hardware-counter finding. Even though the absolute
penalty is only around 0.03–0.04 ms, it rules out a blanket default switch.

An earlier force-only dense probe found about 23%, 9% and 2%
improvement on the three grids. The broader run supports the larger dense gains and exposes the
small-input tradeoff. These tests do not establish a crossover threshold for automatic selection;
that needs more cell-occupancy distributions and more GPU vendors.

## What changed

The previous precision fix checks whether a 64-candidate block is full after every candidate.
The candidate kernel splits each cell range into chunks ending at the next block boundary.
Inside a chunk, the loop only loads a point and adds its contribution. Counter updates and block
flushes happen outside that loop.

A partial block carries across cell boundaries. It still contains exactly 64 candidates, including
self and rejected neighbors as zero contributions; 16 block totals still form a group. The traversal,
pair-force function, cutoff rounding helper and strength application are unchanged. Scatter order
is nondeterministic, so separate runs need not produce bit-identical force buffers.

Candidate statistics are also cheaper: add each visited cell's occupancy, then subtract one for self.
This is exact because the grid stores every point once and the searched rectangle always includes
the target's own cell. The one-point, boundary, coincidence and evolved-state regressions exercise
this invariant. No additional simulation buffer, dispatch or readback is introduced.

## Compare it yourself

Start the lab with `pnpm --filter @cosmos.gl/gpu-lab dev` from the repository root.
On [Neighborhood forces → Demo](#/neighborhood-forces), choose **Compare precision cost** and keep the tab visible. The run uses its own matrix;
the demo's visible controls do not affect it. **Export JSON** preserves raw timestamps, validation,
GPU metadata, batch calibration and the ordered plan. **Cancel sweep** stops the comparison and
leaves completed rows available for export.

| Scenario | Points | Density | Radius |
| --- | ---: | ---: | ---: |
| Dense | 65,536 | 16× | 0.16 |
| Sparse | 65,536 | 1× | 0.04 |
| Small | 4,096 | 4× | 0.08 |

Each scenario runs grids 16 / 32 / 64 with four repetitions and both kernels: 72 rows.
Configurations are shuffled with seed 20261109; within each pair, baseline/candidate order reverses
on alternating repetitions. Both use deterministic uniform inputs and a detached 480×480 canvas.

Each row validates before timing. On repetition zero, it also advances three ticks and validates
the evolved state. Failed rows receive no timing result. Every timed stage uses one calibration,
two warm-ups and eight measured batches, targeting about 4 ms per batch with a maximum of 64 operations.
Dense stages naturally use one operation per batch.

**Force** measures neighbor traversal and accumulation over an already-built grid. **Tick** measures
grid build, force, integration and circle rendering. Both repeatedly use frozen input positions;
these are controlled snapshots, not average frame rates of a continuously changing layout.
Readback is outside timing. GPU times come from timestamp queries, not JavaScript submission duration.

The table above uses the median of four per-run GPU medians. Paired savings are the median of
`100 × (1 − candidate / baseline)` for matching repetitions; therefore they need not exactly equal
the ratio of the two displayed medians. Four repetitions are not confidence intervals.

## Precision contract

The force threshold remains `0.0002 + 0.0002 × length(referenceForce)`. Position and velocity errors
must remain below `0.00005`; neighbor counts must match exactly. Every output is checked for finite
values. The expanded reference sample retains the original 128 points and adds 1,024 evenly spaced
points (1,148 distinct targets at 65,536 points). This is sampled evidence, not exhaustive validation
of all targets or arbitrary distributions.

The historical inaccurate serial shader remains available only in **Check dense precision**. This
comparison uses the current precision-fixed kernel as its baseline: no performance gain is credited
to relaxing precision, changing the cutoff or doing less simulation work.

## Regression coverage

The browser GPU suite exercises both precision-fixed kernels on the captured one-ULP cutoff pair
and nine dense cancellation targets across all grids. It also covers single-point, boundary and
coincident positions, clusters, diagonal layouts, partial workgroups, reset and evolved states.
Candidate-count averages match the baseline on those fixtures. The timing tests cover query decoding,
batch normalization, rendering and validation gates; the comparison plan has a reproducibility check.

The candidate and preserved baseline shader files deliberately coexist for A/B experiments. Any
future change to the force formula or cutoff contract must be applied to both before comparing them.
See [Precision findings](#/neighborhood-forces/docs/precision) for the original numerical investigation.
