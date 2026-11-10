## Where the dense mismatch begins

The dense fixture's first tolerance failures occur in **cumulative far-field force after the 64×64 grid level** on Apple M3.
The sampled near force, jitter and clamp pass their checks. Both GPUs show nearly the same failure pattern. This narrows
the investigation to centroid force evaluation and accumulation; it does not establish full CPU parity or a shader fix.

Use **Trace next tick** in the [demo](#/many-body-grid). Select clusters, 8,192 points, eight samples and precise quality,
then reset before tracing to reproduce tick 1. The page moves to the trace results when they are ready.

```flow
Far 8 → 16 → 32 · Small numerical differences, all within budget
Far 64 · First cumulative components exceed the budget
Far 128 → 256 · More components exceed the budget
Near raw → jitter → clamp · All stage checks pass on this fixture
Final force → positions · Some far-field differences remain above budget
```

## What the diagnostic reads

WebGL replays the production level shader into a temporary float framebuffer, reading cumulative force after each level.
Two diagnostic copies of the production near shader return before jitter and before clamping; the unchanged shader supplies
the clamped result. WebGPU adds storage writes at corresponding points in a separate diagnostic kernel. All resources,
passes and readbacks use luma APIs. Temporary GPU resources are released after each trace, including failures.

The trace uses the backend's own aggregates and selected identities in its CPU calculation. The ordinary independent
structure and full-output checks still run. A replay check compares the instrumented final force with normal execution
using the unchanged budget. A failed replay makes the run a mismatch and labels its trace as unrepresentative.
Even a passing replay cannot guarantee that instrumentation preserved every compiler decision at intermediate stages.
This is a diagnostic replay, not a timed execution or a capture of the original shader's registers.

Rows report component failure count, maximum absolute error and the worst **error / component budget** ratio.
A ratio above one fails. The target index and x/y component identify that worst ratio, which need not be the component
with the largest absolute error. Expand the final-force component detail to follow one target through every stage.

## Native M3 result

Observed in the in-app Chromium browser on Apple M3 with ANGLE Metal for WebGL. Conditions: clustered fixture, 8,192 points,
K=8, precise quality, tick 1. Both instrumented replays passed against their normal outputs.

| Stage | WebGL failing components | WebGPU failing components | Largest absolute error |
| --- | ---: | ---: | ---: |
| Far 8, 16, 32 | 0 | 0 | 1.53e−5 |
| Far 64 | 3 | 3 | 1.07e−4 |
| Far 128 | 11 | 11 | 2.14e−4 |
| Far 256 | 30 | 30 | 3.66e−4 |
| Near raw / jitter | 0 | 0 | 2.67e−5 |
| Near clamped | 0 | 0 | 1.91e−5 |
| Final force | 24 | 23 | 3.66e−4 |
| Positions | 18 | 18 | 3.05e−4 |

At far 64, point 1739's x component has the largest budget ratio, about 1.48. The worst final-force ratio is about 4.11
at point 6627's x component. These are reproducible fixture indices, not universal properties of dense graphs.

## Why evaluation order is a strong suspect

For a cell with position sum `sum` and population `mass`, the reference forms a centroid before subtracting it:

```text
baseline:            center = f32(sum / mass)
                     delta  = f32(position - center)

rounded reciprocal: inverse = f32(1 / mass)
                     center = f32(sum * inverse)
                     delta  = f32(position - center)

fused centroid:      inverse = f32(1 / mass)
                     delta  = f32(position - sum * inverse)
```

The last diagnostic uses JavaScript number arithmetic for the product and subtraction before the final float32 rounding.
It models a fused evaluation form; it is not a dump of the compiled GPU instructions. The final alternative also evaluates
far-field normalization and magnitude with rounded reciprocal square roots. Near-field evaluation stays unchanged.

| CPU diagnostic model | WebGL force / position failures | WebGPU force / position failures |
| --- | --- | --- |
| Original reference | 24 / 18 | 23 / 18 |
| Rounded reciprocal | 23 / 25 | 24 / 25 |
| Fused centroid delta | 2 / 3 | 2 / 3 |
| Fused delta + inverse roots | 1 / 2 | 1 / 2 |

This is evidence that the centroid expression's rounding and subsequent force arithmetic explain much of the discrepancy.
It is **not** evidence that the alternative model is the correct portable oracle: some components still fail, and another
GPU can choose a different permitted evaluation. The original reference and tolerance remain unchanged. Alternative
results are exported as hypotheses and never used to turn the baseline verdict into a pass.

[WGSL's floating-point rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation) allow reassociation and constrained
fusion; division and built-ins such as inverse square root have specified accuracy allowances. A sequence of CPU
`Math.fround` calls therefore need not reproduce every permitted GPU result. This general rule supports investigating
evaluation order; it does not identify the exact instructions used in this run.

[luma's precision guide](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision) likewise cautions that classic
compensated arithmetic depends on rounding points a compiler may not preserve. Adding an extra temporary variable or
Kahan-style correction is not, by itself, a verified precision fix.

## What to do with this evidence

The [separate centroid pass comparison](#/many-body-grid/docs/centroids) now tests the storage-boundary hypothesis.
It does not fix the dense mismatch: GPU-stored centroid values can still differ from CPU division by one ULP, and the
8,192-point dense case gets worse. Feeding those same stored values into the CPU model removes most, but not all,
failures. The targeted integer-count correction now matches centroid bits exactly but leaves 2 force / 2 position failures at
8,192 dense points on the M3. Keep the strict comparison as the guard and next probe the remaining individual force contributions.

Only after the arithmetic contract is understood should this experiment claim dense CPU parity or proceed to a combined
layout-quality claim. The exact-radius versus grid-partition difference remains a separate convergence question.

## Reproduce and retain

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/
```

Use **Export JSON** after tracing. It includes stage summaries, worst-component values, replay verdicts and alternative
arithmetic comparisons alongside the normal run settings. Raw per-point trace arrays are not exported or committed.
Keep machine captures local; share these findings and the reproduction settings. Software-browser tests validate the
trace/replay contract and failure reporting; they do not assert these M3-specific failure counts on other hardware.
