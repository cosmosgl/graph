# Collision above 4,096 points

The exact kernel covers graphs through 4,096 points. Production WebGL instead
uses a wrapped grid above that size. It keeps up to 32 sampled neighbors per
bucket for this study's point counts. Points in different world cells may
compete for those slots. A contact uses each matching world cell once.

## What we compare

Can WebGPU build the wrapped buckets and reproduce the collision correction
above the cutoff? The candidate uses GPU buffers to build the lists, select
slots and apply corrections. The independent CPU model groups points by
bucket and sorts each group, then applies the collision rule in the production
neighborhood order. It uses the production grid dimensions, rotations and
per-pass hash formula. It explicitly rounds the hash arithmetic to float32
and keeps the lowest point index when hashes tie. The legacy depth-buffer
ordering and its tie behavior require a separate comparison against WebGL.

| Points | Cases | Schedule |
| --- | --- | --- |
| 4,097 | Unequal sizes, pin and absence flags, final-index coincidence, touching cells that alias at a signed block boundary | Four passes, alpha 0 / 1 / 0.5 / 0.25, cooling off |
| 8,192 | Fixed radius and padding, final-index coincidence, dense cell and distant alias sharing at least 70 occupants, equal float32 hashes | Five passes, alpha 1 / 0.64 / 0 / 0.36 / 0.25, square-root cooling |

Both fixtures use a separated lattice for the rest of the points, a fractional
world origin, and fixed seeds 0 / 0.125 / 0.25 / 0.375 / 0.5 in order. The
4,097-point recipe uses 12.5-unit cells. The 8,192-point recipe uses the 8-unit
minimum with a fixed radius of 3 and padding of 0.5. Each pass changes rotation
as in production. GPU state stays resident across passes through the existing
position integrator with friction 1. Readbacks are diagnostic.

Every pass checks every slot ID and position flag exactly. Pin and absence
coordinates are preserved exactly, including absent NaNs. Absent force is
zero. Force and position differences must meet the existing float32 gate
`2e-5 + 3e-5 × abs(reference)`, including positions on independently evolving
CPU and GPU paths. The one-own-radius force cap allows `2e-5` absolute error.
Each active pass must move at least one point. Alpha zero with positive cooling
must preserve every position. The CPU controls also check that the touching
cell alias contributes once, the dense bucket exceeds 32 members, rotation
splits that bucket, and a tied hash keeps its first representative.

This checks one isolated force on the native M3 WebGPU adapter. The bounds are
4,097–8,192 points, 32 slots, one collision pass at a time and these recipes.
WebGL depth-peel equivalence, dense-bucket throughput, adaptive sizing,
larger counts, rendering and the fully composed simulation remain separate
gates. One invocation selects slots per bucket, so a dense bucket can serialize
the selection even though each force evaluation examines at most 9 × 32 slots.

Use `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision/hashed-slots.test.ts`
with a unique `LAB_ARTIFACT_RUN` and the source variables described in the
[validation workflow](#/validation-workflow). The test stores raw counters, device
identity and source identification in `captures/`. Timing is outside this study.
