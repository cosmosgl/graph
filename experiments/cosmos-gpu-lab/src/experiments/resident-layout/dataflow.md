The migration needs a simulation that can **compute and render without downloading every position each tick**.
This experiment compares that dataflow with the staged WebGPU reference from the combined-layout study.
Both lanes use the same luma kernels, force order, topology, arithmetic mode and cooling schedule.

## What changes in the resident lane?

```flow
Resident positions · The previous tick's output
Gravity · Compute force, integrate, swap buffers
Bounds reduction · Min/max in workgroups; reduce the partial bounds
Frame finalization · Apply the existing padding and deterministic jitter on the GPU
Hierarchical repulsion · Build aggregates and samples, compute force, integrate
Directional springs · Incoming, integrate, outgoing, integrate
Draw · Circles and straight links read the current position buffer
Checkpoint only · Download and compare both lanes
```

The staged control downloads the post-gravity positions and calls the existing CPU `frameFor` function.
The resident lane replaces that download with a hierarchical min/max reduction. Every group reduces up to
256 records; further dispatches reduce those partial records until one remains. Absent points contribute
an identity value; pinned points still contribute to the bounds. Empty and all-absent inputs use zero extrema.

One final GPU invocation applies exactly the existing frame arithmetic: square extent, minimum extent,
one-seventh padding, deterministic x/y jitter and reciprocal span. Its small arithmetic sequence uses luma's
integer-controlled expansion operations to preserve the CPU's float32 rounding. This correction is outside
the per-point loop. The seed and two jitter values are small CPU parameters, independent of positions.

The resulting four-float box is a storage buffer read directly by grid construction and force evaluation.
Min/max needs no floating-point atomics, and separate dispatches separate workgroup reductions from their
consumers. This follows WebGPU's [ordered usage scopes](https://www.w3.org/TR/webgpu/#programming-model);
a workgroup barrier alone would not synchronize independent workgroups.

## What is checked?

At tick 1, every fifth tick, and the final tick, both lanes download and compare:

- The four frame values, bit for bit.
- Final positions and outgoing spring forces, bit for bit.
- Hierarchy aggregates, sampled neighbor slots and stored centroids, bit for bit.

This is a stronger **dataflow-equivalence** test than a tolerance comparison. It does not replace the
independent CPU force checks: both lanes share the force implementation and could share a force bug.
The [passing precision reference](#/combined-layout/docs/gravity-trig) retains that separate evidence and
its unchanged tolerances. Native-f32 remains available as a control; matching it does not make its known
CPU-reference failures disappear.
Non-finite present positions or forces fail a checkpoint even when both lanes contain identical bits.

An unchecked resident tick performs no position readback, completion wait or CPU oracle evaluation.
The staged lane still waits each tick, and checkpoints synchronize both lanes. The side-by-side run is
therefore a correctness comparison, not a resident-frame performance measurement. Snapshot counters count
calls that download both force and position buffers; checkpoint bounds and hierarchy downloads are additional.

## Run it

Start the lab and open [GPU-resident layout](#/resident-layout). Choose a graph and point count, keep
**Refined gravity + rounded steps**, then **Run comparison**. A passing checkpoint has zero differences in
every column. The two canvases draw directly from each lane's current GPU positions using a fixed camera.
Use **Export JSON** to keep local results; measurement exports are not committed.

Native GPU regressions from the repository root:

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/bounds.test.ts src/experiments/combined-layout/resident.test.ts
```

The bounds test independently checks CPU frame bits at 0, 1, 255, 256, 257, 8,192 and 65,537 records,
including padded workgroups, three reduction levels, absence, pinning, coincident positions and multiple seeds.
The composed tests compare four graph fixtures at both 128 and 8,192 points over 20 ticks, rendering each tick
and checking five checkpoints.

## Findings and remaining work

Native checks on **11 November 2026**, Apple M3, headless installed **Chrome 157.0.8103.40**, pinned
**luma 10.0.0-alpha.4**, using **Refined gravity + rounded steps**:

| Check | Result |
| --- | --- |
| Independent GPU bounds | All CPU frame bits match across the seven counts and five scenarios/seeds per count |
| Chain, communities, star and pinned graphs, 128 and 8,192 points | **40/40 checkpoints** match every compared buffer bit for bit |
| Snapshot reads per 20-tick run | Staged **25**; resident **5**, all at checkpoints |
| Unchecked resident ticks | **0** position snapshots; no CPU oracle |

The previous gravity-trigonometry regression and the 8,192-point communities negative-control/correction
regression also pass through the restored automated runner. The full six-case 8,192-point strict-reference
matrix now passes automatically as well: 126 scheduled checkpoints and six full-strength probes over the
100/300-tick schedules. Their original CPU tolerances are unchanged. The scaling timing case was excluded
from that validation run; no new timing result is claimed.
No complete-frame timing or larger composed-graph result is inferred from these checks.

This is an engine slice: gravity, hierarchical repulsion, directional springs, cooling and minimal drawing.
It still uses fixed sample counts, CPU-built topology and the diagnostic hierarchy's crowded-cell fallback.
It does not implement the remaining forces, picking, richer rendering, live updates or host-owned devices.
The two GPU lanes own separate devices. Resident work currently submits each force/integration stage;
command batching and complete-frame timing remain separate questions.

Finite, ordinary graph coordinates are the current arithmetic domain. Extreme/subnormal coordinates and
other native GPUs need additional coverage. The production numerical/layout-quality contract and luma
dependency version remain decisions for the migration; this experiment changes neither production default.
