This diagnostic separates the intended force or sum from compatibility with an existing arithmetic
path. It is a bounded investigation, not a new production acceptance gate. Follow the
[validation workflow](#/validation-workflow) and [research report](#/numerical-research).

## Gravity comparison

All paths receive the same frozen `Float32Array` with 257, 1,024 or 4,096 points, including the
origin and signed axes. A seeded generator covers distances approximately `2^-12` through `2^12`.
Inputs are finite; this study does not cover overflow, subnormal coordinates, masks or integration.

- **Analytic reference:** `force = -position * alpha * gravity * coefficient`, evaluated in JavaScript
  double precision on the uploaded float32 positions and float32 constants. Alpha is 1, gravity is
  0.25 and the coefficient is float32 0.1. This is the intended linear law, not a GPU operation emulator.
- **CPU float32 polar model:** the existing `combined-layout/reference.ts` gravity calculation.
- **Production GLSL polar:** `createCombinedWebGL` executes the imported production gravity shader;
  only its gravity stage runs. Readback reports the force before judging integration separately.
- **Native WGSL polar:** a diagnostic translation using native distance, angle, sine and cosine.
- **WGSL Cartesian:** the direct linear expression without trigonometry.

Maximum absolute, RMS and relative L2 errors use force x/y components only. The legacy comparison
uses the original `many-body/reference.ts` mixed component tolerance. Neither budget nor shader is
changed to make a row pass. The CPU model's compatibility self-match is not independent validation.
The refined strict candidate and its historical cost remain in the existing
[gravity study](#/combined-layout/docs/gravity-trig).

Axis and non-axis mathematical errors are reported separately. Native `atan2` has restricted
accuracy guarantees for zero or extremely small components; those cases must remain visible rather
than being folded into ordinary rounding noise. The export includes the worst component inputs and
outputs. See [WGSL atan2](https://www.w3.org/TR/2026/CRD-WGSL-20261106/#atan2-builtin).

## Controlled summation

The selected point count is also the number of identical inputs supplied to each sum path.

| Fixture | Repeating input | Exact sum of a full four-value group |
| --- | --- | --- |
| Cancellation | `16777216, 1, -16777216, 1` | 2 |
| Positive | `1, 2, 3, 4` | 10 |
| Balanced | `1024, -1024, 1, -1` | 0 |

All fixture values and partial JavaScript double sums are bounded integers below `2^53`, so their
double sum is exact. This argument is specific to these fixtures, not arbitrary floating-point arrays.
The 257-record preset includes a partial group and exercises tail handling.

CPU controls implement serial float32 additions, 64-value blocked sums and a 256-lane strided tree.
WGSL kernels use the same loop structures with native arithmetic. The tree is one workgroup;
barriers separate its shared-memory stages. Each output is downloaded before reusing the output
buffer. These are compute diagnostics, not production WebGL blending or the full hierarchy builder.

A difference between a GPU result and the CPU order model suggests evaluation variation; it does
not establish fusion or reassociation as the cause. Changing fixture or seed preserves the same
reported reference roles. The study does not automatically tune a threshold or precision policy.

## Native M3 findings

Measured **12 November 2026**, headless installed Chrome **157**, Apple M3 (ANGLE Metal for WebGL),
luma **10.0.0-alpha.4**, seed **5931**. The nine UI runs cover three sum fixtures at each of 257,
1,024 and 4,096 records. All GPU paths completed and produced finite forces and sums. Gravity
inputs are repeated across the three sum fixtures; these are three distinct gravity populations,
not nine independent seeds. Raw local exports live in ignored `captures/precision-<count>-<fixture>.json`.

Maximum absolute force-component error against the analytic law:

| Path | 257 records | 1,024 records | 4,096 records |
| --- | ---: | ---: | ---: |
| CPU float32 polar model | `9.733e-6` | `1.194e-5` | `1.194e-5` |
| Production GLSL polar | `1.735e-5` | `2.037e-5` | `2.037e-5` |
| Native WGSL polar, all components | `0.05` | `0.05` | `0.05` |
| Native WGSL polar, non-axis only | `1.735e-5` | `2.037e-5` | `2.037e-5` |
| WGSL Cartesian | `3.465e-6` | `3.545e-6` | `3.545e-6` |

Production GLSL and Cartesian WGSL both pass the original compatibility gate at all three counts.
Cartesian WGSL has lower maximum mathematical error than the CPU polar model on these inputs.
That is evidence against requiring the CPU operation sequence universally; it is not an integration,
trajectory, portability or performance approval.

The diagnostic native polar kernel reverses the vertical force at points `(0, 1)` and `(0, -1)`:
its y components are approximately `+0.025` and `-0.025`, respectively, instead of `-0.025` and
`+0.025`. Both failures remain in its compatibility result. GLSL and Cartesian WGSL have the
intended signs on this device. This isolates an axis case in the native polar diagnostic, but does
not establish a driver violation: the `atan2` x argument is zero, outside its ordinary bounded
accuracy domain. The strict refined candidate is not the native diagnostic and is not implicated
by this result. Explicit axis handling or Cartesian evaluation needs validation for any native
production candidate.

For cancellation sums, CPU float32 and corresponding native WGSL results agree exactly:

| Records | Exact fixture sum | Serial | Blocked 64 | Tree 256 |
| --- | ---: | ---: | ---: | ---: |
| 257 | 16,777,344 | 16,777,216 | 16,777,220 | 16,777,344 |
| 1,024 | 512 | 1 | 16 | 512 |
| 4,096 | 2,048 | 1 | 64 | 2,048 |

All positive and balanced controls return their exact fixture sums in all six CPU/GPU sum paths.
The cancellation rows demonstrate a shared CPU/GPU numerical weakness, not a port mismatch. The
tree's exact result depends on these fixtures; no claim of universally exact or superior tree
summation follows. No force or layout acceptance threshold was changed.

Focused tests run with `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/precision-diagnostics/precision.test.ts`.
They check bindings, analytic axes for the Cartesian law, positive sums and finite cancellation
outputs. Cancellation error is required only by the deterministic CPU demonstration; native GPU
sums may be exact. Tests do not require the same native polar axis failure on other adapters. The
current test provider uses installed Chrome without forcing a software adapter; record the actual
adapter. The older `LAB_NATIVE_GPU=1` flag is redundant. See the Lab README for the existing-browser option.

## Reproduction

The cancellation fixture demonstrates why compatibility and accuracy differ: adding 1 to `2^24`
and rounding to float32 loses it, even though the integer sum can be evaluated exactly in double.
Actual native-device results must be recorded with their environment; the tables are observations,
not universal GPU expectations. The JSON includes raw force outputs and both input arrays.

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Precision diagnostics**.
2. Run cancellation, positive and balanced fixtures at 257 and 1,024 records. Change the gravity
   seed to check another frozen input; use 4,096 for a larger bounded case.
3. Inspect mathematical error separately from legacy compatibility. An unavailable backend is a
   partial result, never a pass. Export JSON for native-device evidence.
4. If a difference is consequential, isolate contributions and integration using the existing
   force studies. Evaluate independent layout quality and normal-frame cost before selecting a candidate.

No timers run in this diagnostic. Setup, readbacks and CPU calculations make wall-clock run duration
unsuitable as a performance result. Device resources are released after each backend completes;
navigating away discards stale UI results while in-flight work finishes cleanup.
