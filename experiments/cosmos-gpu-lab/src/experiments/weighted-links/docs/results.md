The current WebGL baseline is `luma-model-directional-v1`: luma `Model`/`UniformStore`, explicit render
passes and independent directional shader bounds. Historical raw-WebGL captures are not comparable
performance samples; see the [baseline correction](#/weighted-links/docs/context-loss).

## What this experiment establishes

The first migration question is semantic compatibility: can luma WebGPU reproduce Cosmos's ordered,
weighted directional spring passes while drawing the resulting state without routine position readback?
This page records the tested scope, not a claim that the complete engine is ready to migrate.

## Initial findings — 9 November 2026

- The initial lab GPU suite passed **39 tests**, including **17 weighted-link tests**, in Chromium with
  the software adapter. These are correctness checks, not native-GPU performance measurements.
- On native Apple M3 (WebGL via ANGLE Metal, WebGPU via the browser's Apple adapter), the 128-point star
  passed ten ticks. At tick ten, both GPU backends matched each other exactly and differed from the CPU
  by at most about `6 × 10⁻⁸` across the checked outputs.
- A 2,048-point multi-hub graph with 4,091 links passed ten ticks. At tick ten the largest WebGL/WebGPU
  difference was about `9 × 10⁻⁸`. The eight-point edge-case fixture passed ten ticks with the active
  collision rest-length floor, both before and after replacing links.
- luma's pinned alpha supports the buffer → compute → integration → render path without native pipeline
  creation. This moves luma integration from an API assumption to a working isolated workload.

These checks support semantic feasibility. They do not establish large-graph speedups or production readiness.

## Reproduce correctness

From the repository root:

```sh
pnpm install
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/weighted-links/links.test.ts
```

Open [Weighted link forces](#/weighted-links). Select a fixture, press **Step + validate** or
**10 validated ticks**, then **Replace links + reset** and repeat. The pair uses two points and the edge-case
fixture uses eight; other fixtures use the selected count. Toggle the collision rest-length floor for
its additional spring constraint.

Validation compares every component of both directional force outputs and both integration outputs with
a float32 CPU reference. The reference indexes original edge IDs into independent JavaScript lists rather than using the GPU's CSR. The UI also
compares WebGL with WebGPU. CPU state evolves independently across validated ticks.

The acceptance rule is `abs(actual − expected) ≤ 2e−6 + 2e−5 × abs(expected)`; non-finite values fail.
This is a dedicated spring error budget, not a relaxation of the neighborhood-force experiment's tolerance.
Short trajectories do not establish long-term layout quality or bitwise identity across GPUs.

Fixtures cover pair, chain, star, disconnected clusters, multiple hubs and edge cases. Regression checks
include weights zero/0.25/1/4, fallback weights, repeated links, a self-loop, coincident positions, pinning,
absence, invalid endpoint indices, empty topology, reset, connectivity replacement, capacity growth and
finite oversized spring steps. Hubs exercise 1,025 points. Each normal fixture runs five ticks before and
after connectivity replacement, plus a reset check.

## Reproduce measurements

Press **Measure stages** for the selected interactive fixture, or use **Sweep 1k–10k** / **Sweep 1k–100k**
for matched topology comparisons. Sweep filters select one backend, topology or point count when diagnosing
a case. [Native findings and reproduction details](#/weighted-links/docs/performance).

**WebGL spring loop** selects the production shader with separate per-direction bounds or a lab variant that stops
once the point's adjacency is exhausted. Exports record the choice; do not mix results from the two variants.
**Check WebGL rendering only** isolates the initial 100k-star image from simulation and timer queries.
See the [reset investigation](#/weighted-links/docs/context-loss) for the native pass-isolation results, the failed WebGL-only trajectory, and the finer context-loss event trace.

A 25-tick CPU trajectory gates measurements, with full snapshots checked at ticks 1, 10 and 25.
Validation submissions are completed one backend/tick at a time and are outside every timing interval.
A calibration chooses one shared batch size for both backends, targeting 6 ms and capped at 64 operations.
Two batched warmups precede seven samples per stage; backend order alternates each sample.

### Every operation sees the same input

A third position resource holds the final benchmark output. A frozen tick reads P0, writes intermediate P1,
then writes final P2 to this scratch resource instead of overwriting P0. Repeating the tick therefore does
not evolve or settle the graph. Reset/upload and the preparation of canonical P1, forces and P2 happen
before timing. No per-operation reset copy is hidden inside the measured interval.

| Metric | Scope |
| --- | --- |
| CPU CSR build | Stable grouping/property construction, two warmups and seven samples; excludes upload |
| Resource setup | One recreation per backend/case, including packing, allocation, upload and program setup |
| Upload calls | CPU time inside buffer writes or texture allocation/upload calls; not GPU transfer bandwidth |
| Force | Both directional spring passes, each reading its correct frozen position state |
| Integration | Both integration passes using precomputed canonical forces |
| Render | Points and links from precomputed P2 |
| Tick | Both spring passes, both integrations and rendering from P2 |
| CPU submit | Encoding/submission divided by operations |
| Completion | Encoding/submission plus completion wait, divided by operations |
| GPU interval | Query interval spanning the entire batch, divided by operations |

### Timer validity and completion

WebGPU uses luma `QuerySet` pass timestamps. WebGL uses
[`EXT_disjoint_timer_query_webgl2`](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
with one elapsed-time query around the batch. Availability is polled in a later browser task. Disjoint,
invalid, timed-out or unavailable readings remain null, not zero; a stage only gets a GPU median if all
seven samples are valid. Optional timer support is not required for the experiment to run.

Raw batch durations, batch size, normalized durations and timer status are exported. GPU intervals exclude
validation, reset/preparation, query readback and completion synchronization; they can still include idle
gaps, scheduling effects and backend overhead between GPU passes. They are not pure shader instruction time.

WebGL completion includes a one-texel/pixel read after the query ends; WebGPU waits for queue completion.
Those wall-time synchronization mechanisms differ, so use valid GPU intervals for direct GPU comparisons.
`gl.finish()` alone previously produced near-zero completion readings and is not the completion gate.

Stop preserves completed stages/cases. A device/context error stops the run and exposes **Restart devices**;
export first, since restarting clears in-memory results. Errors include their current phase in the capture.

Use **Export JSON** for local raw samples, browser/device information, parameters and validation results.
Do not commit captures or archives. Share portable findings here in Markdown with the workload and reproduction
steps, distinguishing native hardware from the Chromium software adapter used by automated tests.

## Remaining migration questions

- How do high-degree serial gathers scale on native GPUs at realistic graph sizes?
- Can a topology builder retain adjacency order efficiently for state-preserving live updates?
- Does the chosen luma resource model work with shared/host devices and device loss?
- How do springs compose with global many-body, cooling and the other Cosmos forces over long trajectories?

These should be answered before interpreting this link-only demo as production readiness.

The temporary production replay tools have been removed and their investigation is parked.
The [WebGL reset investigation](#/weighted-links/docs/context-loss) retains the historical comparison
and unresolved native limitation. The remaining lab tests use the independent CPU reference.
