## Does a separate centroid pass fix dense precision?

The follow-up [far-field correction](#/many-body-grid/docs/far-field) now passes both checked dense sizes by refining
force arithmetic and storing contributions before accumulation. The division-only findings below remain unchanged.

**The ordinary separate pass does not fix it on the checked Apple M3 cases.** Storing centroids prevents the centroid division from being fused with the later
position subtraction, but it does not make GPU division match the CPU reference. At 8,192 clustered points, the stored
variant has more failing force and position components than the inline baseline. At 16,384 it has slightly fewer,
but still fails. The tolerance is unchanged. A targeted integer-count division candidate now reproduces every checked centroid exactly,
but still leaves a few dense force/position failures; see the correction results below.

Open the [demo](#/many-body-grid), choose clusters, 8,192 points, eight samples and precise quality. Reset, then click
**Compare centroid pass**. The table includes the three centroid variants plus three far-field variants on identical input positions, bounds, seed and
sample budget. The canvases keep the inline baseline; the stored variant is a separate temporary backend used for
validation. No alternative replaces the production WebGL comparison or the original CPU oracle.

## The change being tested

```flow
Build aggregates · Preserve the existing deterministic sums, counts and selected samples
Centroid dispatch · One invocation per cell writes sum.xy / count into a separate float32 storage buffer
Force dispatch · Load the stored centroid, subtract it from the target position and evaluate the existing force
Integrate and check · Compare forces and positions with the unchanged CPU reference
```

The inline path evaluates `position - sum / count` inside the force kernel. The stored path reads its already-written
centroid in a later dispatch. Empty cells store a zero centroid; their counts still exclude them from force traversal.
Near-field force computation and integration are unchanged. luma kernels, buffers, passes and readbacks implement both
paths; the production GLSL files are unchanged.

The extra buffer stores `[center.x, center.y, count, 0]` for every hierarchy cell. Both tested large counts have a finest
grid of 256×256, so the addition is **1,397,760 bytes (about 1.33 MiB)** and **one compute dispatch**. This diagnostic does
not measure GPU time, and no performance advantage is claimed. Temporary comparison resources are destroyed after
reading results or on failure.

## Native M3 findings

In-app Chromium, Apple M3 WebGPU; eight samples, precise quality. Counts below are failing scalar components under
`2e−5 + 3e−5 × abs(reference)`. Each first tick starts from the deterministic fixture.

| Input | Inline force / position failures | Stored force / position failures | Outcome |
| --- | --- | --- | --- |
| Uniform, 8,192, tick 1 | 0 / 0 | 0 / 0 | Both pass |
| Clusters, 8,192, tick 1 | 23 / 18 | 36 / 33 | Stored is worse; neither passes |
| Clusters, 8,192, tick 2 | 0 / 0 | 0 / 0 | Both pass after the CPU-model tick expands the fixture |
| Clusters, 16,384, tick 1 | 67 / 65 | 61 / 61 | Stored improves the counts slightly; neither passes |
| Absent / pinned fixture, 8, tick 1 | 0 / 0 | 0 / 0 | Both pass |

Grid aggregates, sample identities and instrumented replay checks passed. At 8,192 dense points, the maximum force error
rises from about `3.66e−4` inline to `4.88e−4` stored; position error rises from `3.05e−4` to `3.97e−4`. Cumulative far-force
failures still begin after the 64×64 level. The raw near force, jitter and clamp pass. A passing second tick does not
resolve the startup failure: these are same-input comparisons driven by the CPU model, not a convergence test.

## What the centroid readback tells us

At 8,192 dense points, **265 stored centroid components differ from correctly rounded CPU division**, by at most one ULP.
At 16,384 dense points, the count is 301, again at most one ULP. The uniform 8,192-point fixture has 1,474 differing
components but passes its force checks: sensitivity to rounding matters more than the number of differing centroids.

A second CPU diagnostic uses the exact centroid values read back from the GPU, while preserving the same force loops
and all later CPU rounding. This isolates centroid-value differences from downstream evaluation:

| Dense input | Stored GPU vs original CPU | Stored GPU vs CPU using GPU centroids |
| --- | --- | --- |
| 8,192 points | 36 force / 33 position failures | 1 force / 1 position failure |
| 16,384 points | 61 force / 61 position failures | 5 force / 3 position failures |

Centroid values explain most of the discrepancy in these runs, but not all of it. The remaining failures require finer
pair-force and accumulation probes. The shared-centroid CPU diagnostic is **not** a replacement oracle and cannot make
the stored variant pass the original check.

[WGSL division accuracy and evaluation rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation) do not require every
runtime division to reproduce correctly rounded CPU division. A storage boundary fixes when a value becomes float32;
it does not correct the division that produced that value. This explains why preventing fusion alone is insufficient,
without proving the exact compiler instruction sequence.

## Targeted integer-count division correction

The corrected candidate keeps the separate centroid buffer and replaces only `sum / count`. Counts are positive integers
bounded by the lab's 16,384-point cap. The shader extracts the binary32 sign, exponent and significand, divides the integer
significand by the count, and uses the exact integer remainder to choose round-to-nearest, ties-to-even.

```flow
Decode · Read the float32 sign, exponent and significand as integer bits
Divide · Integer quotient and remainder of the significand / point count
Extend · Append at most 14 binary digits to obtain a normalized significand
Round · Compare twice the remainder with the denominator; ties choose an even significand
Store · Reassemble the float32 bits and write the centroid buffer
```

Each extension step doubles the quotient and remainder, then subtracts the count if the remainder is large enough.
This avoids constructing a wider-than-32-bit numerator. Within the supported count range, the quotient fits 24 bits and
the doubled remainder is below 32,768. Underflow rounds directly in subnormal units, avoiding an intermediate rounding.
Empty cells stay zero. The helper is specialized for finite float32 sums and counts in 1…16,384; it is not a general
floating-point library or a validated million-point-count divider.

This uses core WGSL integer operations, not floating-point atomics, float64, or an FMA-based residual correction.
Integer evaluation makes the rounding decision explicit; a compiler cannot legally reassociate it into approximate
floating-point division. [WGSL integer arithmetic](https://www.w3.org/TR/WGSL/#integer-arithmetic).
The CPU reference, force kernels' arithmetic, selected samples and force/position tolerance remain unchanged.

### Independent division validation

Each corrected comparison runs a 131,080-case GPU corpus and compares returned bit patterns with CPU float32 results.
It covers every denominator from 1 through 16,384, positive and negative values, varying exponents, large finite inputs,
normal/subnormal boundaries, signed zero, ties and underflow. Both software Chromium and native M3 produced **zero
bit-pattern mismatches**. This is broad regression coverage, not exhaustive coverage of all possible input bit patterns.
The isolated bit-pattern check does not claim that the rest of a floating-point simulation preserves subnormals.

The actual centroid buffer is also read back: it has **zero differing components, zero ULP difference** from CPU division
of the same aggregate sums on the tested M3 fixtures. Corrected runs cannot pass if the corpus or this exact centroid
check fails, even if the force output happens to fit its budget.

### Dense results with the original force tolerance

Apple M3, tick 1, clustered fixture, eight samples and precise quality:

| Points | Inline force / position failures | Ordinary stored | Corrected division |
| ---: | --- | --- | --- |
| 8,192 | 23 / 18 | 36 / 33 | **2 / 2** |
| 16,384 | 67 / 65 | 61 / 61 | **5 / 1** |

At 8,192 points the corrected maximum force and position error are both about `1.83e−4`. At 16,384 they are about
`4.88e−4` and `3.66e−4`. Maxima alone do not determine failures: the budget depends on each reference component's magnitude.

The first cumulative far-field tolerance failure now appears at **128×128**, rather than 64×64. At 8,192 points,
point 49's y component is the worst budget ratio at that level; point 3131's y component is the worst final-force and
position ratio. At 16,384 points, the corresponding first-level target is 10070/y, while final force is worst at 9364/x
and position at 13647/x. Near raw, jitter and clamping stages pass. Structure and instrumented replay checks also pass.

This establishes that the targeted correction fixes the centroid-division mismatch, **not the complete dense force
comparison**. The remaining differences lie downstream in force evaluation/accumulation and propagation to positions;
matching centroid bits does not prescribe how GPU normalization, square roots and sums are evaluated. Keep the failing
full verdict visible and probe those contributions next. Do not switch the CPU oracle to GPU-derived values to hide it.

The corrected path still adds one dispatch and the same 1.33 MiB centroid buffer for these counts. Its integer divisions
and bit loop have **not been timed**. It remains an opt-in candidate, not the default or a demonstrated performance win.

## Decision and reproduction

Keep inline evaluation as the default and retain the separate pass as an opt-in diagnostic. Do not promote it as a
precision fix or relax the tolerance. The [per-cell investigation](#/many-body-grid/docs/far-field) now isolates downstream rounding and demonstrates a passing candidate.
Its extra memory and GPU time still need evaluation. A generic extra pass alone is not enough.

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/centroids.test.ts
```

**Export JSON** includes all six verdicts, centroid rounding statistics, stage summaries, the same-centroid CPU check and
resource counts. The row's ordinary `passed` verdict still refers to the displayed inline comparison; the candidate has
its own `centroidComparison.storedPassed`. The corrected result is stored separately under
`centroidComparison.corrected`, including its division corpus and unchanged force verdict. An unavailable candidate is reported separately. Keep machine captures local;
share the settings and findings here instead of committing raw measurements.
