# Collision as a positional constraint

Cosmos collision treats each point as a disc. Its effective radius is a fixed positive `simulationCollisionRadius`, or half the resolved point size, plus `simulationCollisionPadding`. This experiment imports the production **exact all-pairs GLSL unchanged**, ports the same law to luma WebGPU, and checks an independent stepwise-float32 CPU reference.

The production exact path applies through **4,096 points**. Larger production graphs use spatial hashing and depth-selected slots. This first experiment does not port that large-graph algorithm.

```flow
Current positions and resolved sizes
One target per fragment or invocation · inspect other points in ascending source-index order
Reject absent or non-overlapping pairs
Project overlapping discs toward contact · split correction by squared radii
Apply strength and optional alpha cooling
Cap the summed correction at one own radius
Integrate with friction 1 · preserve pinned and absent positions
Repeat from the updated positions · configured collision iterations
```

## The pair correction

For target `a`, source `b`, separation vector `delta = position[a] − position[b]` and contact distance `r[a] + r[b]`, an overlapping pair contributes:

```text
direction = delta / length(delta)
overlap = r[a] + r[b] − length(delta)
correction[a] += direction × overlap × r[b]² / (r[a]² + r[b]²)
```

The smaller disc yields more. A pinned disc still blocks other points; the integrator preserves its own position. Its partner receives the normal radius-weighted share, so contact with a pin can require several iterations. Two overlapping pins cannot separate and are reported separately.

Below the production `1e-4` separation threshold, the shader uses a deterministic golden-angle direction based on the **target index**. This is not a symmetric pair impulse or a momentum-conserving solver. The correction is a positional projection, rather than a persistent velocity.

Each pass multiplies the sum by strength and `alpha^cooling` when the cooling exponent is positive. At exponent zero it uses full strength, even when alpha is zero. It then caps the correction at one own radius and integrates with friction **1**. The ordinary simulation’s 0.85 friction would under-apply this constraint.

Cosmos follows a radius-weighted relaxation idea also described by [D3’s collide force](https://d3js.org/d3-force/collide). The production GLSL is the behavioral contract here: D3’s anticipated positions, scheduling and integration are not this GPU algorithm.

## WebGPU execution

One invocation owns one target correction and scans sources in ascending order. It writes one correction and does not update neighboring targets, so float atomics are unnecessary. A following dispatch integrates into the other position buffer. Repeated collision passes read the updated positions.

The **Native f32** control translates the pair law using ordinary WGSL arithmetic and trigonometry. **Strict reference** reuses the lab’s explicit float32 arithmetic helpers and high/low trigonometry for the golden-angle fallback. The selector controls the collision force kernel; integration and other composed forces retain the existing strict reference. Both collision kernels are checked at exactly the same CPU budgets; a faster path does not gain acceptance by changing the tolerance. Integer-controlled arithmetic inside the quadratic loop can be expensive. WGSL allows implementation-dependent floating-point errors and evaluation choices; see the [WGSL accuracy rules](https://www.w3.org/TR/WGSL/#floating-point-accuracy).

Absent points are excluded before arithmetic, including NaN sentinels and finite positions left by a fade. GPU buffers/textures, kernels, models, passes, rendering and timestamps all use luma APIs.

## Isolated and combined comparison

**Collision only** runs just the configured projection/integration passes. **Combined forces** runs gravity → center attraction → exact repulsion → incoming springs → outgoing springs → collision iterations. Center strength is 1, gravity/spring settings use the existing production-variation reference, and positions use the default world frame around `(2048, 2048)`.

The WebGPU center reduction defaults to a **high/low sum**. Each 32-byte partial holds two float32 limbs per coordinate and an integer count; 256 invocations reduce them in 8 KiB of workgroup scratch. Both limbs survive every dispatch, and the final high limb supplies the existing float32 aggregate. The pinned luma `fp64arithmetic` module runs `sum_fp64` with integer-controlled arithmetic, avoiding dependence on compiler preservation of hand-written compensation expressions. This changes only accumulation: center division, force/integration, collision and the independent CPU oracle stay the same. It fixes the [observed dense composition failure](#/collision/docs/findings) within the tested envelope, without a CPU intermediate or a tolerance change. Double-single’s precision/exponent limits still apply; it is not a general exact or binary64 sum.

The advanced **Center reduction (WebGPU)** selector retains the original float32 tree as a control. It changes neither production WebGL blending nor the CPU summation order. The center precision table reports the maximum aggregate, force and position error across the run, including errors too small to fail a local gate. Exported settings record the selected reduction.

When collision is enabled, both spring directions also floor their desired length at the sum of effective endpoint radii. Omitting this production coupling would let springs demand overlap that collision then repeatedly undoes.

Every validated tick resets both GPUs to a shared CPU starting state. Stage checks evaluate each GPU’s actual intermediate input; a separate whole-tick check uses the independent CPU chain. Repulsion uses fixed shared random samples. This isolates numerical error and does not establish independently evolving trajectory identity. Alpha is held at the selected value; this page does not reproduce Graph’s wall-clock cooling scheduler.

Collision and whole-tick gates reuse the existing `2e-5 + 3e-5 × |reference|` budget. Springs retain their tighter `2e-6 + 2e-5 × |reference|` budget. Flags must match exactly. Only explicitly absent coordinates may preserve NaN sentinels. No tolerance constant changes.

Absent spring targets have no consumed correction: the production shader can emit NaNs there, and integration skips them. Following the lab’s existing present-target force contract, those unused XY spring outputs are excluded and their count is recorded. Their positions and flags remain checked. Collision explicitly defines zero correction for absent targets, so **all collision outputs are still checked**, including those zeros. Non-finite present-point outputs always fail.

Geometric overlap counts and maximum penetration are separate observations. Passing a numerical gate does not mean every overlap has disappeared in one pass. Repeated constraints can leave tiny residual overlaps; the page reports them without introducing an arbitrary geometric pass threshold.

The first failing stage or whole tick is retained for local JSON export. **Replay failures** reruns that input, checks output bits and restores the displayed GPU positions without advancing the CPU tick.

## Added GPU cost

**Measure added GPU cost** freezes the current CPU geometry, alpha, topology and sizes. Isolated timing backends allocate collision resources before warmup. One camera fits complete discs from the starting geometry and both controls’ preflight outputs across both APIs, then stays fixed for every trial; a collision correction must not change viewport clipping. The camera is included in JSON. Both controls use the same radii and draw style, while positions reflect their computed outputs. The off control skips collision passes; in combined mode it also disables the spring contact-distance floor, as production does.

Two blocks reverse API order; within each block, alternating on/off pairs provide four warmups and twelve measured pairs. WebGPU batches four frozen frames per observation, summing adjacent compute/render timestamp intervals. WebGL times one complete selected frame through luma command timestamps, including clears. Uploads, restore/capture copies, CPU reference work and readback are outside those GPU intervals.

Every control must pass scalar preflight; every captured timed frame must reproduce its validated GPU anchor and pass whole-position checks. Warmups and timer validity also gate acceptance. Invalid, failed or cancelled trials remain in local JSON and cannot produce an accepted summary. An off collision-only frame has no force output, so its unused force scratch buffer is not validated; all positions are checked.

Added cost is the median of paired `on − off` times. The displayed off/on columns are independent medians, whose difference can disagree with the paired median under noise. The delta includes changes in drawing work from the corrected positions, and in combined mode also the changed spring floor. It is not a force-kernel-only measurement. WebGL’s immediate command stream can include CPU/driver submission gaps inside its elapsed interval. Passing validation/query gates does not establish statistical stability; report pair ranges and repeated blocks. These are bounded GPU-work measurements, not production Graph FPS or a universal cross-API speed ratio.

**Compare center precision cost** is a separate WebGPU-only comparison available in combined mode. Both controls keep collision strength, iterations, radii and the spring contact floor enabled. They use the same backend and preallocated resources; only the center sum changes from the original float32 tree to high/low. The same frozen-frame, preflight, exact-anchor, whole-position and timer gates apply. A failed original control rejects the comparison even if the corrected control passes. Use initial geometry for the accepted dense timing control; the known failing tick-2 input cannot establish an accepted speed comparison. The demo state remains unchanged.

## Reproduce

Run `pnpm --filter @cosmos.gl/gpu-lab dev`, open **Cosmos forces → Collision constraints**, choose a fixture and workload, then step or run 100 ticks. Try coincident and masked inputs, variable/fixed radii, padding, one/four passes, and alpha zero with cooling zero/one. Keep the tab visible while timing. **Stop** retains partial timing data; **Export JSON** saves settings, inputs, checks, failures and all timing trials locally.

Native regression command: `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision`.
