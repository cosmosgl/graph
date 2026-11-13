## Spring precision near cancellation

The larger combined runs exposed a specific problem: a spring force could pass its own check, yet produce a
position outside the original budget when the displacement nearly cancelled the starting coordinate. The
[checkpoint investigation](#/combined-layout/docs/checkpoints) records the baseline failures and a concrete example.

The new arithmetic modes investigate that problem **without changing the CPU reference, tolerance, force order,
adjacency order, cooling, gravity, repulsion or production WebGL shaders**. Native f32 remains the default.
These are correctness candidates. The follow-up [Spring cost study](#/combined-layout/docs/spring-cost) measures
their cost and adds narrower alternatives; none is a production recommendation.

## Why integration alone is insufficient

For point 965 in the initial 2,048-point star, the captured x coordinate is −38.9498176574707. The GPU spring force
is 45.7416877746582, one ULP below the CPU force of 45.74169158935547. After multiplication by float32 friction
(approximately 0.85), adding the displacement almost cancels the original coordinate.

```flow
Spring force · A one-ULP difference passes the force budget
Multiply by friction · Product rounding can introduce another difference
Add to position · Cancellation leaves a much smaller coordinate
Check the result · Its relative allowance shrinks; the existing absolute allowance still applies
```

The observed GPU position differs from CPU by 4.06057e−6, against an allowance of 3.38756e−6. Separately rounding
the product while keeping that GPU force would still leave about 3.81470e−6 error. Fixing multiply-add fusion alone
cannot fix this particular capture.

WGSL permits reassociation and fusion, including across function boundaries. Merely splitting the expression into
local variables does not enforce the CPU's rounding sequence. See the [WGSL arithmetic rules](https://www.w3.org/TR/WGSL/#reassociation-and-fusion).

## Four controlled alternatives

| Mode | Spring force | Spring position update |
| --- | --- | --- |
| Native f32 · baseline | Original WGSL arithmetic | Original integration |
| Rounded spring force | Explicit rounded operations | Original integration |
| Rounded spring integration | Original WGSL arithmetic | Explicit rounded multiply, then add |
| Rounded force + integration | Explicit rounded operations | Explicit rounded multiply, then add |

The candidate uses luma's public `fp64arithmetic` shader module through `Computation`, with
`LUMA_FP64_INTEGER_ARITHMETIC` enabled. That path uses integer-controlled arithmetic to avoid depending on the
compiler preserving floating-point intermediate results. We call the public addition, subtraction, multiplication,
division and square-root operations with `(value, 0)` inputs and take the high float32 limb **after each operation**.
This targets the existing stepwise float32 reference; it does not replace the simulation with a double-precision force law.
See [luma's precision guide](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision).

The rounded force follows the same edge order, including the accumulated velocity used by the next edge. It covers
rest-length calculation, position differences, squared distance and square root, the force scale and its component
accumulation. Rounded integration applies only to the two spring stages. The original invalid-value, pinning and
maximum-step guards remain; the long-step clamp and collision branch are not newly rounded. Collision is disabled
in this combined experiment. Do not generalize these results to arbitrary weighted-link configurations.

Luma's arithmetic is a two-float expansion with a finite-normal operating contract, not hardware binary64. The lab
adds a bounded arithmetic regression: 2,052 pairs, including cancellation and zero cases, compare addition,
multiplication, division and square root bit for bit with independently rounded CPU results. Passing this corpus
does not prove correct rounding for every representable float, subnormal, overflow or exceptional input.

## Frozen-input evidence

On Apple M3, standalone Chrome 156, both the WebGL-origin and WebGPU-origin outgoing-stage captures from tick 1 of
the baseline 2,048-point star gave the following results when replayed through WebGPU. Every mode uses the same
captured positions, alpha, graph and CPU expectations; separate devices leave the running layout untouched.

| WebGPU mode | Force failures, GL / GPU capture | Position failures, GL / GPU capture | Maximum position error, GL / GPU capture |
| --- | --- | --- | --- |
| Native f32 | 0 / 0 | 1 / 1 | 1.34e−5 / 1.38e−5 |
| Rounded force | 0 / 0 | 0 / 0 | 3.81e−6 / 3.81e−6 |
| Rounded integration | 0 / 0 | 1 / 1 | 1.53e−5 / 1.53e−5 |
| Rounded force + integration | 0 / 0 | 0 / 0 | 0 / 0 |

Maximum error is over all position components, not necessarily the failed component: every component has its own
`2e−6 + 2e−5 × abs(expected)` allowance. That is why a larger maximum can coexist with a passing result. Rounding
the force is sufficient for these two frozen captures; rounding both removes the measured position difference entirely.
The unchanged WebGL alpha-1 probe after 100 star ticks supplies another frozen outgoing-stage capture. Native
WebGPU gives six position failures; rounded integration alone gives seven; rounded force gives zero (maximum error
1.91e−6); rounding both gives zero error. All four force checks pass. This reinforces the distinction between a
force passing its own budget and that force being accurate enough for a nearly cancelling position update.

A frozen stage is not an evolving trajectory, so the candidate must also be checked over complete cooling runs.

## Evolving-layout validation

The **Rounded force + integration** candidate also passed these native tests on the Apple M3 machine, using
installed headless Chrome 157 and ten-tick checkpoints. Both GPU backends completed every run; the table reports
the candidate's WebGPU checks. Production WebGL remains an unchanged baseline, with its earlier precision failures
still visible rather than corrected by this option.

| Graph | Points | Schedule | WebGPU checkpoints passed | WebGPU alpha-1 probe |
| --- | ---: | ---: | ---: | --- |
| Star | 2048 | 100 | 11 / 11 | Pass |
| Star | 2048 | 300 | 31 / 31 | Pass |
| Communities | 2048 | 100 | 11 / 11 | Pass |
| Communities | 2048 | 300 | 31 / 31 | Pass |

At each checkpoint, the original stage, hierarchy, centroid and whole-tick checks all pass. Unchecked intermediate
ticks remain unvalidated. The independent CPU trajectory is unchanged. This is bounded evidence for correcting the
WebGPU spring-position failures, not a claim of identical trajectories, general convergence or cross-device readiness.
The later [Spring cost study](#/combined-layout/docs/spring-cost) extends the trajectory checks to the force-only
and refined division/root candidates.

**Follow-up:** [Spring cost](#/combined-layout/docs/spring-cost) measures fixed-input GPU batches and tests narrower
corrections. The fully rounded candidate remains the correctness control. CPU readbacks and these correctness-test
durations are not GPU timing evidence.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev`, then open **Combined layout convergence** in native Chrome.
2. Select star, 2048 points and **Native f32 · baseline**. Click **Step + validate**.
3. If spring failures are captured, click **Compare spring rounding**. Inspect the comparison table (now including the narrower diagnostic modes). This uses the
   current session's first failed spring-stage inputs; it does not import earlier JSON. Stop cancels between cases,
   after any pending pipeline creation/readback completes. Partial results remain exportable.
4. Select **Rounded force + integration**, run the 100- and 300-tick schedules for star and communities, and run
   **Probe at α = 1** after each. Changing a setting resets the deterministic graph.
5. Export JSON locally for complete checks, captures and comparison results. The repository keeps this explanation,
   not machine-specific measurement files.

```sh
# Existing software-adapter regressions; native precision tests are explicitly skipped.
pnpm --filter @cosmos.gl/gpu-lab test:gpu

# Installed Chrome, with native GPU selection; includes the precision corpus and larger runs.
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout
```

The software Chromium/SwiftShader process lost its device while compiling the full arithmetic shader in two
attempts, before numerical results were available. That is an unresolved compiler/adapter limitation, not a
numerical pass. Native precision tests therefore require the explicit native command; the baseline and session
regressions continue to run on software Chromium. Native mode requests installed Chrome without forcing an adapter;
verify the reported device when interpreting results on another machine.
