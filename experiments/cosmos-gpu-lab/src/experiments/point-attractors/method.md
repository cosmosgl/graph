# A target for each point

A point at `(8, 0)` with target `(0, 0)` is pulled left. With alpha `0.6`,
coefficient `0.1` and point strength `2`, production computes a correction of
approximately `(-0.96, 0)`. The separate integrator multiplies by friction `0.85`,
so the point moves to approximately `(7.184, 0)`. A negative point strength pushes
it away instead. These are force corrections, not persistent momentum.

Each point has its own target. Unlike [clusters](#/cluster-attraction), this
force needs no centroid, group index or reduction. The individual-targets
fixture sends points toward distinct destinations on a circle. The shared-target
fixture sends every point toward the origin.

## Production rules

The WebGL control imports the unchanged production `ForceAttractor` fragment
shader and production position integrator. The lab prepares their inputs through
luma APIs; it does not instantiate the complete production `Graph` class.

| Input | Production behavior reproduced by the adapters |
| --- | --- |
| Targets | Two values per point. A missing channel or wrong channel length disables all targets. |
| Non-finite target X or Y | That point has no target. Negative finite coordinates are valid. |
| Strength | One value per point. A missing or wrong-length channel defaults every strength to 1. A non-finite element also defaults to 1. |
| Zero or negative strength | Zero disables that point's correction; negative strength pushes away. |
| Coincident point and target | Zero correction; do not normalize a zero-length vector. |
| Pinned or absent point | Integration preserves its position and flags. Pinned points can still have a computed force. |
| No valid targets anywhere | Production skips both the attractor force and its integration stage. |

The adapter packs `(targetX, targetY, strength, present)` into a texture in WebGL
and a storage buffer in WebGPU. Updates replace target data while leaving GPU
positions resident. Complete count changes recreate the isolated backend; this
is not a production setter or retained-capacity implementation.

```flow
Read this point and its target · one invocation per point
Compute distance and direction · skip absent targets and zero distance
Scale correction · alpha × distance × global coefficient × point strength
Integrate · apply friction, pins, absence and the production excessive-step guard
```

## WebGPU and independent reference

The candidate uses luma `Computation` and the existing corrected arithmetic for
subtraction, multiplication, addition, square root and division. It preserves the
production expression's operation order rather than replacing distance times
normalized direction with an algebraically simplified expression. The separate
integration pass also uses the existing corrected arithmetic. No raw WebGPU or
WebGL calls are used.

The CPU reference reads the **raw target and strength channels independently**;
it does not read the adapter's packed array. It rounds scalar operations to
float32 and uses the established CPU integrator. Unused forces for absent points
are excluded, while their coordinates and flags must remain unchanged. When the
stage is inactive, the backend report exposes a logical zero force; the stale
force buffer is not treated as an executed result.

## What is checked

The declared study has nine inputs: a 12-point semantics case and four families
at 1,024 and 8,192 points. Mixed inputs include disabled targets, signed/default
strengths, pins and absent points. Translated inputs add 2,048 to both position
and target coordinates. All generated cases use the fixed seed in `data.ts`.

Each backend evolves for 30 ticks at fixed alpha. At ticks 1, 2, 10 and 30 we
compare its force and integration against a CPU step from its own current
positions, then compare its trajectory against the independently evolving CPU.
Next we change targets and strengths, disable the entire stage, and re-enable
it **without resetting positions**. Finally, a frozen-input update compares both
backends directly from identical positions. Direct comparisons also run at tick 1.

The existing gate stays **absolute `2e-5` + relative `3e-5` per XY component**,
with exact flags and explicit absent-position handling. Disabled-stage positions
must also stay exactly unchanged. Focused tests cover missing/wrong-length
channels, all non-finite targets, zero alpha/coefficient/strength, count changes
and repeated destruction. No result here relaxes a historical failure.

## Cost and limits

Force-only GPU timing uses two warmups and seven batches of 16 evaluations of
frozen positions, alternating backend order. Uploads, integration, rendering,
CPU validation and readbacks stay outside the timestamp intervals. A post-timing
check verifies forces and unchanged positions. Inactive stages are not timed.

These measurements do not apply the complete-frame or picking targets: this is
an isolated force. Thirty fixed-alpha ticks do not establish long cooling
trajectories, full force ordering, production setter/transition behavior,
responsiveness or migration readiness. Follow the [declared recipe](#/point-attractors?section=doc-agent-recipe)
and preserve the separate pilot failures.
