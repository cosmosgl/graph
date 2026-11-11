## Isolating the communities tick-1 failure

The aligned candidate's 8,192-point communities graph fails its whole-tick check at tick 1, despite passing every
individual stage. The first divergence is in gravity's native trigonometry. **Refined gravity + rounded steps**
replaces that trigonometry with extra-precision evaluation through luma and explicitly rounds gravity integration.
The original aligned mode remains available as the negative control. The CPU reference and tolerances are unchanged.

## Evidence before changing the shader

At point 5855, the original final x is −1.1030120849609375 versus the CPU's −1.1030654907226562. Its error,
5.340576e−5, exceeds the 5.309196e−5 component budget. Replacing the gravity output with the CPU's output removes
that failure; rounding gravity integration alone does not.

The new gravity trace exports distance, angle, magnitude, cosine, sine and force components for every point.
Its force buffer matches the original uninstrumented shader bit for bit, so the trace is consistent with the
original computation. This matters because earlier spring instrumentation changed the compiled result.

| Gravity operation | Points differing from the stepwise float32 CPU reference |
| --- | ---: |
| Distance | 0 |
| Angle | 3,642 |
| Magnitude | 0 |
| Cosine | 4,800 |
| Sine | 4,729 |
| Force x | 4,323 |
| Force y | 4,209 |

For example, point 4's angle is 0.8728706240653992 on the GPU and 0.8728707432746887 on the CPU. Such small
upstream differences propagate through shared grid aggregates and ordered springs. The final failing point
need not be the first point whose angle differs.

```flow
Native angle and trigonometry · Different rounded gravity components
Gravity positions · Small input differences enter the hierarchy
Repulsion and ordered springs · Differences propagate through coupled forces
Final coordinate near cancellation · Whole-tick component exceeds its existing budget
```

This is permitted numerical variation, not evidence of a WebGPU validation error. WGSL does not require native
`atan2`, `sin` or `cos` to reproduce the CPU's rounded results; see the
[WGSL accuracy table](https://www.w3.org/TR/WGSL/#floating-point-accuracy). The experiment keeps its stricter
comparison contract and tests whether a GPU correction can meet it.

## The targeted GPU correction

The helper carries extra precision in two float32 components using public luma `sum_fp64`, `sub_fp64`,
`mul_fp64` and `div_fp64` operations with integer-controlled arithmetic. It does not require hardware float64.

For sine and cosine, reduce the angle by the nearest multiple of π/2, then evaluate degree-17 and degree-16
Taylor polynomials on the small remainder using Horner evaluation. Split π and π/2 into three float32 pieces
so reduction remains accurate close to an axis. Restore the quadrant signs afterward.

For the angle, native `atan2` provides an initial estimate q. With higher-precision sine s and cosine c of q,
form the cross/dot residual:

```text
r = (y·c − x·s) / (x·c + y·s)
corrected angle = q + (r − r³/3 + r⁵/5)
```

Round the corrected angle to float32 before evaluating the final sine and cosine, matching the CPU operation
sequence. Explicit axis handling preserves signed-zero angle behavior. The native estimate is a seed; its bits
are not the final angle result.

The candidate also reuses the existing rounded integration kernel for gravity, repulsion and both spring passes.
All force evaluation and integration remain GPU dispatches through luma APIs. CPU boundary substitutions occur
only in the diagnostic replay.

## Check the correction independently

The helper check uses 8,198 vectors: a uniform angular sweep, deterministic random directions with varied
magnitudes, and explicit signed axes. Expected values come from the independent JavaScript Math reference,
rounded to float32. On the measured M3, angle, sine and cosine have **zero bit mismatches**.

In the captured 8,192-point graph, the refined trace also has zero differences in every gravity field. Its force
buffer matches the uninstrumented refined shader. Gravity force and position buffers for tick 1 match the CPU
exactly. Refined trigonometry alone removes the captured failure; rounding gravity integration as well reduces
the whole-tick maximum error from 4.20e−5 to 1.53e−5, with every component inside its unchanged budget.

These are measured results, not a proof of correctly rounded trigonometry over every float32 input. The helper
is scoped to the lab's finite normal coordinate ranges and angles around [-π, π]. Other adapters, extreme
ratios, subnormal coordinates and broader production settings need their own validation.

## Trajectories and GPU cost

Standalone Chrome 156 on Apple M3 passed all six 8,192-point trajectories: chain, communities and star,
at both 100- and 300-tick schedules. All **126 scheduled checkpoints and six full-strength probes pass**,
including the individual stages, hierarchy, centroid and whole-tick checks. Every run completes with finite
positions and no backend errors. Intermediate ticks remain unvalidated. Each whole-tick reference starts from
that backend's actual starting positions; the independent CPU trajectory is also retained.

| Fixture | 100-tick checkpoints / probe | 300-tick checkpoints / probe |
| --- | --- | --- |
| Communities | 11/11, pass | 31/31, pass |
| Star | 11/11, pass | 31/31, pass |
| Chain | 11/11, pass | 31/31, pass |

A paired GPU timing run on the fixed initial 8,192-point star input uses two warmups, seven samples and rotated
mode order. All 12 force-only and force-plus-integration rows pass every batch check. The table shows milliseconds
per force-plus-integration evaluation, median with min–max range:

| Stage | Failing aligned candidate | Refined gravity + rounded steps |
| --- | ---: | ---: |
| Gravity | 0.1720 (0.1362–0.2611) | **2.9819 (2.5559–5.0627)** |
| Repulsion | 3.3260 (3.2932–3.3751) | 3.4079 (3.2768–3.6209) |

The correction fixes the tested numerical contract at substantial gravity cost: about 17× the aligned control's
median in this run. Repulsion ranges overlap. These are stage GPU timestamps, excluding upload, compilation,
CPU prediction, validation, readback and rendering; they are not complete-tick or frame-rate measurements.
The cost measures reproducing Cosmos's existing polar evaluation order. It does not establish that this is the
best production implementation of a physically linear gravity force.

The 8,192-point correctness gate now passes on M3 for this candidate. Larger trajectories, other adapters and
more production force settings remain unvalidated. Optimizing the correction and checking the larger star's
GPU cost are the next steps.

## Reproduce

1. Open Combined layout convergence; select communities, 8,192 points, and **Aligned gravity + repulsion · diagnostic**.
2. Use **Step + validate**, then **Isolate tick error**. Check original-output reproduction, the native/refined gravity
   tables, and the independent trigonometry result. Export JSON retains example differences and captured arrays locally.
3. Select **Refined gravity + rounded steps**. Run both cooling schedules for communities, chain and star; validate
   checkpoints and the full-strength probe. Earlier failures remain part of acceptance.
4. Use **Time gravity + repulsion** to compare the candidates on identical frozen inputs. Keep other GPU work idle.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu gravity-trig.test.ts
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=8192 LAB_SCALE_PRECISION=trig pnpm --filter @cosmos.gl/gpu-lab test:gpu scaling.test.ts
```

The automated browser runner stalled at startup in this session, including a previously passing small test.
Incomplete runner attempts are not counted as passes. The app's GPU helper checks, replay and trajectory results
were observed in standalone Chrome on Apple M3. Measurement JSON stays local; the lab retains export and reproduction tools.
