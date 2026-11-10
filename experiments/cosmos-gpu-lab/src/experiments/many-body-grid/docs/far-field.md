## Closing the dense far-field mismatch

**The refined, stored-contribution candidate passes the checked dense cases at the original tolerance.**
On Apple M3, both 8,192 and 16,384 clustered points pass force and position checks over three CPU-anchored ticks.
At the first dense tick, every cumulative far-field level matches the CPU exactly. This is a bounded correctness
result, not a production-ready performance result or a claim of bitwise portability across GPUs.

The default inline path is unchanged. The failing intermediate candidates remain visible so the lab distinguishes
agreement with production WebGL from agreement with the independent CPU reference.

## What happens at 128×128?

After the [centroid division correction](#/many-body-grid/docs/centroids), centroid bits agree with the CPU, but the
first cumulative far-field tolerance failure appears at 128×128. A new replay selects the worst target at that level
and records each visited cell, displacement, squared distance, direction, force contribution and running sum.
The diagnostic also compares its final force with the ordinary execution; a replay mismatch invalidates its verdict.
Instrumentation may change optimization, so these values are not a literal capture of the original shader's registers.

For 8,192 clustered points, precise quality, eight samples, tick 1, the selected target is point 49:

| Quantity at 128×128 | Components differing from CPU | Maximum absolute difference |
| --- | ---: | ---: |
| Cell identity / population | 0 | 0 |
| Centroid displacement | 0 | 0 |
| Squared distance | 7 | 9.54e−7 |
| Distance | 10 | 2.38e−7 |
| Force magnitude | 15 | 3.81e−6 |
| Normalized direction | 32 | 1.19e−7 |
| Individual force contribution | 44 | 7.63e−6 |
| Running sum within this level | 53 | 3.81e−5 |

These are exact-value differences, **not** counts of tolerance failures. The full force has positive and negative
contributions; cancellation can leave a small component whose original error budget is also small. A few ULPs in many
intermediate operations can then exceed that budget. The 128×128 row is cumulative: it also includes earlier levels.

The first observed arithmetic difference is `dx² + dy²`. The CPU rounds each square before addition. GPU `dot` may
use a fused multiply-add. Division and normalization have their own rounding behavior; WGSL allows reassociation and
fusion, so merely spelling the same formula with more temporary variables does not impose CPU rounding boundaries.
See [WGSL floating-point accuracy](https://www.w3.org/TR/WGSL/#floating-point-accuracy) and
[reassociation and fusion](https://www.w3.org/TR/WGSL/#reassociation-and-fusion).

## The candidate, step by step

```flow
Hierarchy · Build the same aggregates and sampled near neighbors
Corrected centroids · Divide position sums by integer counts, then store the rounded centers
Far contributions · Evaluate each selected cell with refined arithmetic; store one float32 pair per cell and target
Force accumulation · Load those pairs in the original cell order, then add the unchanged sampled near force
Integration · Apply the unchanged position update and compare with the original CPU reference
```

The correction has three parts:

1. **Round each square explicitly.** The shader multiplies the 24-bit significand using integer chunks, retains the
   full 48-bit product in two `u32` words, and rounds once with ties-to-even. The subsequent addition therefore cannot
   absorb an unrounded multiplication. This exact path covers normal inputs whose squared result is normal; outside
   that range it falls back to native multiplication. It is not a complete software float library.
2. **Refine division and square root.** An initial hardware estimate is corrected with its residual:

   ```wgsl
   let q = a / b;
   let improvedQuotient = q + fma(-q, b, a) / b;

   let s = sqrt(a);
   let improvedRoot = s + fma(-s, s, a) / (2. * s);
   ```

   The first residual measures the numerator left after `q × b`. The second measures the error in `s²`;
   dividing by `2s` supplies a Newton correction. Far-field direction uses component division by the refined distance.
   The original softening rule is retained: below unit squared distance, the magnitude denominator uses another square
   root. These floating-point refinements are verified candidates, not a WGSL guarantee of correctly rounded roots or
   division on every implementation. `fma` itself has implementation latitude.
3. **Store contributions before adding them.** A compute dispatch writes the completed x/y force for each far cell. A
   later dispatch accumulates those float32 values in the original order. This prevents contraction across the
   contribution/accumulation boundary. The near-field code and CPU oracle are unchanged.

Neither changing `normalize` to explicit division nor storing ordinary contributions was sufficient in the initial
M3 probes. Refining roots/division without explicit square rounding left one force failure at 16,384 points.
Refined arithmetic without the contribution buffer also fails that case, as the table below shows.

## Native Apple M3 results

Precise quality, eight samples, clustered fixture, tick 1. Entries are failing **force / position components**,
using the original `2e−5 + 3e−5 × |reference|` budget:

| Variant | 8,192 points | 16,384 points |
| --- | ---: | ---: |
| Original inline | 23 / 18 | 67 / 65 |
| Ordinary stored centroids | 36 / 33 | 61 / 61 |
| Corrected centroid division | 2 / 2 | 5 / 1 |
| Refined far arithmetic, accumulated directly | 0 / 0 | 1 / 2 |
| **Refined + stored contributions** | **0 / 0** | **0 / 0** |

For the last row, maximum force / position errors are `6.10e−5 / 1.22e−4` at 8,192 points and
`1.22e−4 / 2.44e−4` at 16,384. Those maxima pass because the component budgets include a relative term.
All cumulative far-field levels match exactly in these first-tick native runs. Remaining differences are in the
unchanged near-force and integration paths, and stay within tolerance. Structure, centroid and replay checks pass.

Both dense counts also pass ticks 2 and 3, with a fresh common frame/seed and CPU positions at each tick. This tests
consecutive shared inputs, not independently evolving GPU trajectories. An 8,192-point uniform fixture and the
8,192-point clustered fixture with balanced quality also pass on the M3.

Software Chromium tests require full CPU parity at both dense sizes over three ticks. Additional tests cover both
shell qualities, uniform/coincident points, absent/pinned points and boundaries. A separate **65,024-case GPU corpus**
checks rounded squares bit-for-bit across every normal-result exponent, both signs and boundary significands on that
software adapter. The existing **131,080-case centroid division corpus** remains part of the comparison.

## Cost and migration decision

The contribution buffer reserves 100 cell slots per level per target, each a pair of float32 values. Only visited,
occupied entries are written and read; unused entries do not need clearing. Producer and consumer use the same frame,
centroids and traversal. The consumer reads cell populations from the centroid buffer, keeping even instrumented
pipelines within WebGPU's minimum eight-storage-buffer limit.

| Dense point count | Contribution buffer | Centroid buffer | Total extra storage | Extra dispatches per tick |
| ---: | ---: | ---: | ---: | ---: |
| 8,192 | 37.50 MiB | 1.33 MiB | **38.83 MiB** | 2 |
| 16,384 | 75.00 MiB | 1.33 MiB | **76.33 MiB** | 2 |

These are additional working buffers versus the inline path, not total device memory. Diagnostic readback buffers
are temporary and excluded. These are the original full-buffer costs; the follow-up
[precision cost comparison](#/many-body-grid/docs/precision-cost) measures GPU time and reduces extra storage by about 80%. This deliberately simple storage layout is capped by
this experiment's 16,384-point limit and is not a million-point design.

Keep this as an opt-in correctness reference. The streamed candidate now preserves these rounding boundaries
using one level of scratch storage. Validate more native vendors and longer independent trajectories
before promoting a replacement. The experiment does not change production Cosmos or claim that its original GLSL
force now meets the dense CPU budget.

## Reproduce and inspect

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/far-arithmetic.test.ts
```

Open **Hierarchical global repulsion**, choose **clusters**, **8,192** or **16,384**, **8 samples**, **Precise**,
then **Compare centroid pass**. The comparison advances one CPU-anchored tick and displays all six variants. Reset
before comparing a first-tick capture; repeat the action twice for ticks 2 and 3.

Expand **128×128 contributions** under corrected division to inspect the first failing level; expand the refined
candidate's force stages to check every level. **Export JSON** retains full per-cell rows in
`centroidComparison.corrected.contributions` and the refined direct replay in `centroidComparison.refined.contributions`.
The full candidate's checks and costs live under `centroidComparison.materialized`. Per-cell arrays follow this order:
`dx, dy, mass, cell, squaredDistance, distance, denominator, magnitude, directionX, directionY, forceX, forceY,
levelPrefixX, levelPrefixY, priorFarX, priorFarY`. CPU and GPU rows are separate; they never replace the independent oracle.
Keep captures local and share settings and conclusions here rather than committing measurement JSON or ZIP files.
