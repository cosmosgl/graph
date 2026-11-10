## Does a separate centroid pass fix dense precision?

**No, on the checked Apple M3 cases.** Storing centroids prevents the centroid division from being fused with the later
position subtraction, but it does not make GPU division match the CPU reference. At 8,192 clustered points, the stored
variant has more failing force and position components than the inline baseline. At 16,384 it has slightly fewer,
but still fails. The tolerance is unchanged.

Open the [demo](#/many-body-grid), choose clusters, 8,192 points, eight samples and precise quality. Reset, then click
**Compare centroid pass**. The table compares two WebGPU executions on identical input positions, bounds, seed and
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

## Decision and reproduction

Keep inline evaluation as the default and retain the separate pass as an opt-in diagnostic. Do not promote it as a
precision fix or relax the tolerance. The next focused investigation should compare individual cell contributions and
centroid-division rounding, then verify any arithmetic correction against the original reference, production behavior
and GPU cost. A generic extra pass is not enough.

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/centroids.test.ts
```

**Export JSON** includes both verdicts, centroid rounding statistics, stage summaries, the same-centroid CPU check and
resource counts. The row's ordinary `passed` verdict still refers to the displayed inline comparison; the candidate has
its own `centroidComparison.storedPassed`. An unavailable candidate is reported separately. Keep machine captures local;
share the settings and findings here instead of committing raw measurements.
