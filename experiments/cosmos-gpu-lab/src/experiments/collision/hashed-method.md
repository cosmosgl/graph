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
and keeps the lowest point index when hashes tie.

The direct WebGL control runs the production GLSL peel and correction shaders
through luma v10. It peels into two RG32F targets with depth24plus, then copies
each result into the slot texture array. Readback samples the published array.
Each pass compares CPU, WebGL and WebGPU using the same input positions. The
trajectory check feeds each backend its own prior positions as well.

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

The isolated comparison covers 4,097–8,192 points, 32 slots and the two recipes
above. One invocation selects slots per bucket, so a dense bucket can serialize
selection even though each force evaluation examines at most 9 × 32 slots.

Use `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision/hashed-slots.test.ts`
with a unique `LAB_ARTIFACT_RUN` and the source variables described in the
[validation workflow](#/validation-workflow). The test stores raw counters, device
identity and source identification in `captures/`.

## Normal tick

The opt-in WebGPU path runs collision after gravity, center, repulsion and
both spring passes. Each collision iteration rebuilds the slot grid from the
latest resident positions, computes the correction and integrates with friction
1. Its own uniforms carry the rotation and peel seed so two passes submitted
together receive different seeds. The Lab derives those seeds from the tick
times the iteration count plus the collision iteration. The rotation uses the
production formula, and the CPU reference replays the same Lab seed schedule.
The exact path runs through 4,096 points. Higher counts in the experiment use
the hashed path up to 8,192. Zero strength skips collision.

The moving check runs three ticks on an 8,192-point connected communities graph
with varying point sizes, one pin, one absent point and square-root collision
cooling. A separate dense input exercises two iterations that use different
seeds and positions. The test shrinks the same graph to the exact boundary,
then regrows and updates sizes to exercise the new grid scale. The earlier
force, position and fixed-point gates apply.

For timing, two warmup pairs resume the same initial positions before every
frame. The seven measured pairs then alternate lane order and run four frames
per lane. The two lanes run the same core passes and draw at 480×340. One lane
also runs both hashed collision passes. Both apply the spring contact floor so
the timing isolates the added collision passes and their effect on drawing.
In each pair, subtract the median baseline GPU frame time from the median with
collision. Report the median of those seven differences. Every recorded frame
is compared with the CPU positions outside the timed interval.

Set `LAB_NATIVE_VISIBLE=1 VITE_LAB_HASHED_COLLISION_COST=1` with the source
variables above and run
`pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision/hashed-composition.test.ts`.
The normal-tick test covers this single 8,192-point workload on M3. Larger
counts and dense-bucket throughput remain open.
