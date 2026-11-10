## Initial validation

The required-WebGPU Chromium suite passed **36 tests** across the CPU reference, production GLSL, both WGSL loops
and UI verdict handling using the software adapter. These are correctness checks, not native-GPU performance results.

The fixtures cover a pair, deterministic uniform cloud, dense clusters, coincident points, pinning, NaN/finite absent
positions, zero coincidence directions, the distance-1 falloff boundary and the strict near/far cutoff. Tests also cover
empty input, a singleton, partial workgroups, reset, zero alpha, the integration displacement guard and reusing evolved inputs.
UI tests ensure a missing backend cannot produce a full pass and a one-step error cannot be relabeled as trajectory drift.

### Same-input correctness versus trajectory drift

An initial test that compared independent trajectories with the one-step error budget failed on the coincident stack
at tick 2 in **all three GPU paths**, including production WebGL. Rechecking each tick against a CPU evaluation from
that backend's actual previous positions passed without changing the tolerance.

This distinguishes sensitivity to evolved inputs from a demonstrated one-step port error. It does not prove that the
independent trajectories have acceptable long-term layout quality. The UI retains both views: strict same-input checks
and separately labeled trajectory drift. No timing or production-readiness claim follows from these checks.

## Native Apple M3 observations

Checked on 9 November 2026 in the Codex in-app Chromium browser: WebGL reported ANGLE Metal on Apple M3;
WebGPU reported the Apple adapter. Both use the lab's pinned luma v10 packages. The WebGL lane runs production GLSL
through luma v10, not a complete production `Graph` instance on luma v9.

Parameters: alpha 0.6, repulsion 1, friction 0.85, reference length 4,096; fixed seeded samples and positions.
The following same-input checks passed for **both direct and tiled WGSL** alongside production GLSL and CPU:

| Workload | Observed checks |
| --- | --- |
| Uniform, 128 points | Ten ticks; tick-10 WebGPU/CPU maximum force error 1.79e−7, position error 3.81e−6 |
| Uniform, 4,096 points | Direct tick 1 and tiled tick 2; maximum force/position error across the reported checks no greater than 7.63e−6 |
| Dense clusters, 65 points | Ten ticks, every force and position component checked |
| Coincident stack, 65 points | Ten ticks on shared CPU inputs, with the original tolerance |
| Absent / pinned / zero-direction fixture, 8 points | Ten ticks, including preserved NaN sentinels for absent coordinates |
| Near/far and distance-1 boundaries, 8 points | Ten ticks |

A separate 65-point coincident run with **tiled WGSL and independent trajectories** passed all ten same-input
one-step checks. At tick 10, maximum position drift from the independent CPU trajectory was **7.02e−4** for both GPU
lanes; WebGPU/WebGL position drift was **1.30e−4**. These are measured drift values, not a layout-quality acceptance rule.

No context loss was observed in these runs. This is evidence for the isolated exact force on one native GPU, not a
cross-browser stability guarantee or proof that the earlier weighted-link issue is resolved. These correctness runs do not establish whether tiling is faster. The separate
[batched timing findings](#/many-body/docs/timing) record the subsequent matched native measurements.

## Acceptance rule

For each force and position component:

```text
abs(actual − reference) ≤ 2e−5 + 3e−5 × abs(reference)
```

This fixed, experiment-specific one-step budget was set before GPU validation and was not increased after the coincident
trajectory failures. It is not a tolerance change to another lab experiment. Flags and unused output components must match
exactly. Non-finite present coordinates fail. An explicitly absent NaN coordinate may preserve its NaN sentinel; the absent
point's force must still be finite zero. Every component is checked, not a sample of targets.

## Reproduce

From the repository root:

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body/
```

Open [Global many-body repulsion](#/many-body). Start with **Same input each tick**, a 128-point uniform cloud, and
**Ordered direct**. Use **Step + validate** or **10 validated ticks**. Repeat with the tiled loop and the edge fixtures.
Changing a control recreates the backends and resets the comparison, so captures never mix configurations.

Then choose **Independent trajectories**. Read the “same input” rows as one-step correctness and the “independent path”
rows as accumulated drift. A failed or unavailable backend is shown explicitly and prevents a full-comparison pass.
**Stop** finishes the in-flight tick and preserves completed records. **Reset / retry devices** clears current records;
export first if needed.

**Export JSON** includes the workload, fixed parameters, tolerance, browser/device information and all completed checks.
Keep raw captures local; share concise findings in Markdown with reproduction conditions. Elapsed validation time includes
CPU reference calculation, GPU work, readback and drawing submission; it is not a GPU timestamp or a speed comparison.

## Still to establish

- Native coverage beyond this Apple M3 browser, including the 4,096-point boundary and longer runs.
- Broader timing coverage beyond the [initial M3 sweeps](#/many-body/docs/timing), plus evolving workloads and rendering.
- A justified trajectory-quality budget and longer combined-force runs.
- Production hierarchical far-field and sampled near-field parity above the all-pairs threshold.
- Composition with weighted links, center/gravity, cooling and remaining forces.

The earlier weighted-link WebGL context-loss investigation remains parked. This experiment's small all-pairs baseline is
validated independently; it neither resolves nor reproduces that separate issue by assumption.
