**Moving Cosmos to luma WebGPU is technically credible. The experiments support the core architecture,
but the library is not yet ready to switch its production backend.**

We can already reduce data, build spatial indices, calculate local forces and render points on WebGPU.
The remaining uncertainty is whether the **complete Cosmos behavior**—global layout, weighted links,
collision, rendering, interaction and host integration—can meet its correctness and performance requirements
through the chosen luma APIs.

The purpose of this lab is to answer that question with runnable evidence. This page summarizes what that
evidence means for Cosmos and which demonstrations would justify the next migration step.
Assessment reviewed **11 November 2026**; the production engine remains WebGL.

For the complete force and rendering checklist, see [Cosmos feature coverage](#/feature-inventory):
how each feature works in WebGL, what experiments already cover and what still needs WebGPU validation.

## 1. What would make the migration worthwhile?

The target is a full WebGPU implementation of Cosmos with simulation and rendering sharing GPU-resident state.
Narrower device coverage is acceptable. Keeping a WebGL fallback is not a requirement for that destination;
the existing engine remains the behavioral reference while we evaluate the replacement.

| Opportunity for Cosmos | What must be demonstrated |
| --- | --- |
| Express simulation directly as compute work | Cosmos forces preserve their intended behavior and compose into a stable layout |
| Share positions between simulation, drawing and picking | A complete frame avoids routine CPU readback or repacking of every point |
| Use explicit storage and reusable GPU primitives | Data updates, resizing and resource lifetimes remain correct and affordable |
| Improve scalability | Whole-frame time and memory meet agreed budgets on representative graphs |
| Build on luma's WebGPU support | The selected luma release works with Cosmos's resource and integration contracts |

These opportunities make the migration worth pursuing. They do not establish a universal speedup:
performance must be assessed against the same workload, output quality and supported features.

## 2. Cosmos readiness, capability by capability

**Demonstrated** means an isolated capability works in the experiments. **Partial** means the result supports
a migration direction but does not cover the full Cosmos feature. **Unproven** means we still need a relevant
implementation and comparison. These are evidence levels, not a percentage of the migration completed.

| Cosmos capability | Evidence today | Readiness gap |
| --- | --- | --- |
| Global center of mass | **Demonstrated:** WebGL and WebGPU results compared with a CPU reference | Integrate with production force order and state ownership |
| Large reductions | **Demonstrated:** hierarchical reduction with GPU-resident inputs and results | Validate every required aggregation, including cluster centers and bounds |
| Circle point rendering | **Demonstrated:** matched WebGL sprites and WebGPU instanced circles | Complete shapes, strokes, images, transitions and render-order behavior |
| Spatial indexing | **Demonstrated:** count/scan/scatter with variable cell occupancy | Establish production bounds, capacity, update and memory policies |
| Local interaction and integration | **Partial:** CPU-validated local forces feeding GPU rendering | Preserve actual Cosmos integration and collision semantics |
| Global many-body force | **Partial:** exact/hierarchical forces, the production cutoff and resident composition have bounded checks through 8,192 points | Adaptive sampling, scalable construction, production defaults, wider quality and cross-device cost |
| Link forces and graph topology | **Partial:** ordered springs, directional CSR, resident composition and state-preserving replacement | Default-length trajectories, broader parameters, large multi-hub cost and remaining force composition |
| Complete rendering and interaction | **Partial:** circles and minimal straight links read GPU-resident state | Full point/link styling, picking, hover, drag, selection, tracking and overlays |
| luma resource and execution APIs | **Partial:** all isolated experiments use luma resources, models/kernels, passes, fences and timestamps | Host ownership, device loss, reusable scheduling and complete-engine integration |
| Public API and embedded use | **Unproven:** production contracts have not been ported | Dynamic updates, lifecycle, exposed position resources and deck integration |
| Hardware/browser portability | **Partial:** native Apple measurements and software-WebGPU regressions | Native validation across the intended support matrix |

The strongest conclusion today is a **validated, bounded WebGPU engine slice**: composed forces, GPU bounds,
minimal drawing and live storage updates use public luma APIs. A representative Cosmos graph running its
**complete simulation, renderer, interaction and library contract** is still the main missing demonstration.

### Where we are against the plan

| Milestone | Current position | Next acceptance evidence |
| --- | --- | --- |
| luma integration | **Partial:** resident ticks, minimal drawing, preserved updates, retained capacity and controlled GPU-stage timing use public luma APIs | Allocation/trim budgets, host ownership, device loss and the production dependency decision |
| Cosmos simulation | **Partial:** gravity, hierarchical repulsion, ordered springs and cooling have a passing bounded precision candidate at 8,192 points | Remaining forces, layout-quality criteria, scalable hierarchy construction and default-length schedules |
| Rendering and interaction | **Early:** circles and minimal straight links | Styling, picking, dragging and the rest of the renderer |
| Library and embedding contracts | **Unproven** | Live typed-array/config updates, resizing, shared ownership, device loss and host integration |
| Production envelope | **Unproven** | Whole-frame time, peak memory and supported native GPU/browser coverage |

The numerical studies found real porting risks, but exact agreement with one CPU arithmetic path has become
a larger share of the work than planned. Keep the passing corrected candidate as a **reference**, alongside
the native-f32 control. Neither is an approved production policy. Define numerical correctness, independent
layout quality and performance as separate acceptance contracts; the existing tolerances stay unchanged.

The [GPU-resident engine slice](#/resident-layout) now connects GPU bounds, the composed forces and minimal
drawing without routine position readback. [Point capacity and memory](#/point-capacity/docs/findings) adds
same-device growth/shrinkage and cleanup evidence. [Retained capacity](#/point-capacity/docs/reuse) now reduces
bounded update latency by reusing buffers and kernels, at a substantial idle-memory cost. Order-sensitive GPU
frame cost still needs investigation before choosing a production retention policy.
Broader forces, rendering and lifecycle validation should follow alongside targeted numerical work.

### Audit: keep the demonstrated scope separate from production defaults

The recent resource work follows the migration plan. Numerical parity has received more attention than
remaining features; preserve the passing strict candidate and its unchanged tolerances as regression evidence,
then broaden Cosmos coverage instead of making CPU-path arithmetic identity the only migration criterion.

| Contract | Current evidence | Acceptance still needed |
| --- | --- | --- |
| Cooling/default parameters | Staged 32-sample / `[1, 1.2]` controls and selected 5,000-tick adaptive runs pass through 8,192 points | Broader weights/data, reheating, remaining forces and independent layout-quality acceptance |
| Repulsion selection | Inclusive 4,096 cutoff and retained-buffer updates across it pass with position preservation enabled | Full-engine update semantics, broader topology changes and larger counts |
| Sampling/quality | 32 starting samples, GPU occupancy counts, production decision rules and hysteresis pass bounded checks; active counts change without position-buffer replacement | Matched Graph scheduling, allocation/trim policy, larger quality tiers and cross-device cost |
| Graph size | Composed native acceptance through 8,192; some isolated force checks at 16,384 | The 32,768 scaling-harness option is not validated; the current custom WebGPU backend caps input at 16,384 |
| Quality | Matched production-GLSL/WebGPU/CPU trajectories, scale-fitted stress, spring mismatch and restoring probes on M3; two independent 5,000-tick cases | Agreed quality criteria, broader graph families/landmark sets and other native GPUs |
| Hardware gate | M3 native checks plus software-browser regressions | Repeatable native acceptance on the intended GPU/browser matrix; ordinary CI does not run the opt-in native gate |

Large reductions are not large graph layouts. Current update timings and memory use describe the bounded
eight-sample workload, not the full production-default engine. Internal backend generations borrowing a
lane-owned device also do not establish external host/deck ownership or device recovery.

The [controlled GPU stage profiling](#/gpu-stage-profile) method freezes input positions, alpha, seed, topology
and camera, balances execution order, and compares normal whole-frame timing with diagnostic stage passes.
It requires unchanged CPU tolerance and exact instrumentation/replay agreement. Use the results to prioritize
ordered hub springs, scalable hierarchy work and retention/trim policy. Then return to the remaining forces,
renderer, interaction and public API. `GPUCommandGraph` remains an optional evaluation, not a prerequisite.

The [first controlled M3 profile](#/gpu-stage-profile/docs/method) now passes 240 trial and 12 anchor checks
across six runs with the unchanged tolerance. Frozen inputs do not reproduce a consistent large retained-buffer
penalty. The star's first spring pass dominates; aggregation, far-field work and strict gravity dominate chain
and communities. Profiled passes are diagnostic and are measured separately from the ordinary frame path.

The [ordered hub follow-up](#/hub-springs/docs/acceptance) adds independent resident trajectories, tighter
original spring-stage CPU checks and GPU-batched normal-frame timing. All 12 selected-cutoff trajectory cases
pass through 8,192 points and 100/300 ticks, including 264 checkpoints/probes. Threshold controls support a provisional
1,024-neighbor cutoff on M3: degree 256 has no convincing gain, degree 1,024 improves about 3%, and larger hubs
improve about 10–13% at that cutoff. Final-star geometry comparisons improve about 11–14% at both full and
cooled strengths. All 4,608 captured timing frames pass unchanged checks. The plain-direction fallback avoids
applying the candidate where no hubs qualify. These are bounded single-device results; production defaults,
large multi-hub graphs and portability remain open. The candidate stays opt-in.

The [ordered grid aggregation study](#/cell-aggregation/docs/findings) now preserves aggregate/centroid bits
while caching membership and bounding the source-index sort. On M3, passing 8,192-point uniform chain and
community cases improve normal-frame GPU time by roughly 12–15%; prepared inputs also retain gains. Dense
chains improve, while smaller uniform hierarchy controls show no benefit. The candidate stays opt-in and
still scans all sources in crowded cells. Its clustered-community whole-tick failure is now resolved by
the [production layout gates](#/layout-acceptance/docs/findings): all far levels already matched; refined
near-field roots/divisions plus explicitly rounded products remove the amplified error without changing tolerance.

Production routing now passes at 4,095, 4,096, 4,097 and 8,192 points, including retained-buffer resizing
across the cutoff. Combining hub prefetch and cached aggregation passes both 100- and 300-tick schedules for
8,192-point chain, communities and star graphs, with uniform and clustered positions, twice each. All 9,600
evolving tick checks and 3,072 normal timing captures pass. Normal-frame GPU time falls about **10–19%** on
the tested M3; a duplicate-baseline control changes by about −0.6%. These compare two strict WebGPU paths,
not production WebGL performance. Both optimizations remain opt-in. Production-default cooling, broader
force parameters, adaptive sampling, scalable construction and other devices still need acceptance evidence.

The [production-settings follow-up](#/layout-acceptance/docs/production) closes the next bounded parameter
and update gates. Thirty-two starting samples, `[1, 1.2]` spring variation and occupancy-driven sampling
pass staged 100-tick controls and a repeated 300-tick adaptive matrix. Selected chain, dense-community and
unpinned-star runs reach 5,000 ticks and pass their checked ticks and final full-strength probes. A varied
spring exposed a further rest-length rounding boundary; the corrected path retains the original tolerance.

These are **selected parameter and numerical checks**, not complete Graph-runtime acceptance. The long
runs use sparse CPU checkpoints, not an independently evolved CPU trajectory over every tick. Adaptive
sampling reserves 64 slots in this prototype and its paired validation affects wall-clock scheduling.
The [matched layout comparison](#/matched-layout/docs/findings) now adds independently evolved production
GLSL, WebGPU and CPU trajectories in Cosmos's default world frame. Across 12 M3 runs and 11,200 ticks,
the strict WebGPU candidate has zero measured pointwise drift from CPU and passes 1,132 frozen checkpoints
plus 12 full-strength probes. The matrix includes chain, communities and star through 8,192 points,
and independent 5,000-tick communities at 128 and 512 points.

WebGL's layout scores remain close while 35 ordinary checkpoints and four probes fail the unchanged scalar
gate. Those failures stay visible. Longer cooling improves the measured quality, but residual-motion probes
and unagreed quality targets prevent calling these layouts fully converged. The shared CPU-driven sample
tape controls the comparison; it does not validate full Graph wall-clock scheduling or runtime performance.

The next force-composition step is **center attraction**, using the validated reduction as its aggregation
foundation. Broader data and weights, scalable hierarchy construction, allocation policy, remaining forces,
renderer/interaction contracts and native portability remain open.

## 3. What the experiments tell us about Cosmos

### Center and aggregation: a credible replacement exists

The [center-of-mass comparison](#/center-mass) demonstrates that compute reduction can replace the
Cosmos-style blend-based aggregation while maintaining close agreement with a CPU reference.
[Scalable reduction](#/scalable-reduction) demonstrates a hierarchy whose result can stay on the GPU and
be consumed by rendering.

**Meaning for Cosmos:** center, bounds and grouped aggregation have a plausible compute implementation path.
Floating-point render-target blending is not required for this demonstrated center calculation.

**Limit:** a ten-million-point reduction smoke run is not a ten-million-node graph-layout result. It says
nothing by itself about link processing, global force quality, full rendering cost or total engine memory.
[Reduction findings](#/scalable-reduction/docs/results).

### Rendering: points are feasible; renderer parity remains substantial

The [circle rendering comparison](#/point-rendering) shows that WebGPU can reproduce the basic screen-space
circle approach with explicit geometry. Positions can be read from GPU storage, allowing computation and
drawing to share data.

**Meaning for Cosmos:** there is a working foundation for a WebGPU point renderer.
The [weighted-link demo](#/weighted-links) also draws minimal straight links directly from simulated positions.

**Limit:** circles do not prove parity for shapes, strokes, images, highlighting, ordering, animation,
links or picking. Those features need matched visual and interaction tests, including overlap, zoom and
pixel-ratio changes. [Rendering scope](#/point-rendering/docs/limitations).

### Spatial indexing: useful infrastructure, not the whole force model

The [spatial grid](#/spatial-grid) and [neighborhood-force experiment](#/neighborhood-forces) demonstrate
an index feeding local force calculation, integration and rendering without per-tick position readback.
The neighborhood experiment compares two WebGPU algorithms; it is not a WebGL-versus-WebGPU engine benchmark.

**Meaning for Cosmos:** spatially local work has a credible GPU-resident implementation path, including
building blocks relevant to near-field interactions and collision search.

**Limit:** Cosmos's global many-body force includes distant contributions. A radius cutoff discards those
contributions and cannot replace that force without changing the model. Graph adjacency is also different
from spatial proximity: link forces still need topology data such as CSR. Variable-size collision requires
its own coverage and correctness checks.

### Global repulsion: the exact path has a checked baseline

The [many-body experiment](#/many-body) compares the production all-pairs GLSL with direct and shared-memory tiled
WGSL and a float32 CPU reference. It preserves source order, near/far accumulation, coincidence samples, near-force
clamping, absence, pinning and the production integration pass. Both WGSL variants passed isolated native Apple M3
checks, including 4,096 points. [Validation conditions and limits](#/many-body/docs/results).

**Meaning for Cosmos:** the exact force can run through luma compute without floating-point atomics. Shared-memory
tiling can reuse source loads while keeping the per-target addition order. [Batched M3 measurements](#/many-body/docs/timing)
favor WebGPU over the WebGL baseline at 4,096 points, but show no universal winner between direct and tiled WGSL.

**Limit:** independent coincident trajectories drift despite passing same-input one-step checks. Longer layout quality,
force composition and cross-device behavior remain open. The [hierarchical experiment](#/many-body-grid) now checks
production's approximate path with shared CPU bounds and explicit sample counts. Native M3 uniform checks pass at
8,192 and 16,384 points. A dense fixture matches WebGL through WebGPU but fails the full CPU-reference budget;
the app keeps that mismatch visible. [Stage tracing](#/many-body-grid/docs/precision) narrows the first tolerance failures
to the far field after the 64×64 level; centroid evaluation order explains much, but not all, of the discrepancy.
[Storing centroids separately](#/many-body-grid/docs/centroids) does not resolve the dense mismatch; GPU division
rounding remains a major contributor. A targeted integer-count divider now reproduces the checked centroid bits exactly,
but leaves a few dense force/position failures under the original budget. A further
[far-field candidate](#/many-body-grid/docs/far-field) now passes both dense counts over three CPU-anchored M3 ticks,
with refined arithmetic and stored contributions. A [streamed variant](#/many-body-grid/docs/precision-cost) reduces
extra memory from 38.83 / 76.33 MiB to 7.96 / 14.58 MiB. Two native M3 sweeps show comparable complete-step GPU
time between corrected variants, with unchanged validation. Both still cost more than the failing inline control;
[Independent trajectories](#/repulsion-trajectories/docs/findings) now pass all corrected local checks over 20 native
M3 ticks at both dense sizes, with identical full-buffer and streamed outputs. A coincident fixture nevertheless
accumulates substantial CPU-path drift while local checks pass. Larger combined-force runs and scalable
construction remain necessary before considering production adoption. [Detailed findings](#/many-body-grid/docs/results).

**New migration question:** the exact radius split and grid near-field partition can produce substantially different
capped forces in dense data. Matching the WebGL implementation is necessary, but is not enough to establish layout
quality. [GPU-resident bounds](#/resident-layout/docs/dataflow) now match the staged reference in bounded composed runs;
adaptive sample counts and scalable construction still need evidence.

### Combined forces: bounded convergence evidence

[Combined layout convergence](#/combined-layout/docs/findings) runs gravity, hierarchical repulsion and both spring
passes in production order, integrating after each force and cooling after the tick. Every backend continues from
its own resident positions. Stage checks and an additional whole-tick CPU check distinguish local correctness from
independent-path drift; a non-destructive alpha-1 probe distinguishes cooled stillness from full-strength tick stability.

Native M3 chain and community runs at 128 points passed every check for both 100- and 300-tick schedules, including
the probes. WebGL, WebGPU and CPU agreed closely. Slower cooling improved the chain's probe motion, but not the
communities': there is no universal quality gain from extending the schedule. Software Chromium has a visible
production-WebGL gravity mismatch that did not reproduce in these native runs.

A [checkpoint sweep at 512 and 2,048 points](#/combined-layout/docs/checkpoints) now covers chain, community and
star graphs at both schedules. All 512-point cases and 2,048-point chains pass their scheduled checks. The larger
communities and stars expose spring-position mismatches on both backends; ten first-failure captures replay exactly.
A near-cancellation example shows a one-ULP spring-force difference exceeding the tighter final-position budget.
The baseline failures remain visible. A selectable [spring precision candidate](#/combined-layout/docs/spring-precision)
uses luma's integer-controlled arithmetic to reproduce stepwise float32 rounding. Rounding both the spring force
and its integration passes all scheduled WebGPU checks and full-strength probes in the four previously failing
2,048-point runs, without changing the budget. Frozen captures show that integration-only rounding is insufficient.
The [spring cost study](#/combined-layout/docs/spring-cost) now tests a narrower division/root correction: it passes
the same larger trajectory cases and reduces the M3 star hub pass from about 119 ms to 67 ms. That remains much too
costly compared with the 0.51 ms baseline. The distance-only candidate still fails cancellation checks, but a [targeted product correction](#/combined-layout/docs/spring-products)
fixes its counterexample and passes 252 scheduled checkpoints and 12 probes across the 512/2,048-point matrix.
Its rerun star hub cost is 1.74 ms, versus 67.32 ms refined and 120.34 ms fully rounded, with the same tolerance.
The [8,192-point scaling study](#/combined-layout/docs/scaling) passes all 126 scheduled WebGPU checkpoints,
but the 100-tick star's full-strength probe fails its whole-tick comparison. Its spring stages still match exactly.
The star hub costs about 6.99 ms. [Tick-precision replay](#/combined-layout/docs/tick-rounding) traces the error
to repulsion integration, then exposes gravity-order sensitivity along the corrected trajectory. An aligned
diagnostic passes both star schedules and all six probes but regresses communities at tick 1. The complete
acceptance gate for that diagnostic remains open. A follow-up [gravity-math correction](#/combined-layout/docs/gravity-trig)
replaces native trigonometry with extra-precision evaluation and rounds gravity integration. It passes all
126 scheduled checkpoints and six probes at 8,192 points on M3 without changing the budget. Gravity costs
about 2.98 ms versus the failing aligned control's 0.172 ms in the paired run; larger validation remains pending.
Cross-device behavior remains unvalidated; native f32 remains the default. Unchecked ticks
are not counted as passing.

**Limit:** hierarchical repulsion is forced at these small counts. Production's exact-to-grid transition, larger and
dense graphs, default-length cooling, other GPUs and additional forces remain unvalidated in composition. These
readback-heavy checks establish bounded behavior, not a frame-rate or production-readiness claim.

### Resident engine slice: the bounds synchronization can be removed

The [resident layout experiment](#/resident-layout/docs/dataflow) replaces post-gravity position downloads with
a hierarchical min/max reduction and a GPU-written frame buffer. Repulsion consumes that buffer, springs use
the updated positions and minimal points/links draw directly from resident state. Ordinary unchecked ticks have
no position readback, completion wait or CPU force oracle.

Native M3 automated checks at 128 and 8,192 points pass **40/40 checkpoints** across chain, communities, star and
pinned fixtures over 20 ticks. Frame bits, positions, final forces, aggregates, sample slots and centroids match
the staged WebGPU precision reference exactly. Independent bounds tests match the CPU frame bits through
65,537 records; that larger count validates the reduction only, not a composed graph.

The follow-up [resident frame measurements](#/resident-layout/docs/timing-updates) group the simulation into one
compute pass and time it with minimal drawing in one submission. Batched M3 checks at 8,192 points measure
refined GPU work around **5.4 ms** for chain/communities and **12.8 ms** for star. All 120 batch replay checks
pass. Point patches and larger/empty/shrunk topology replacements retain positions, devices, tick and cooling;
independent CPU checks and the existing resident matrix still pass with unchanged tolerances.

**Limit:** the correctness comparison intentionally synchronizes at checkpoints and keeps a staged reference
lane; the benchmark measures an initial engine slice with a minimal renderer. Fixed sample counts, serial
crowded-cell fallback and CPU topology construction remain. Broader rendering, retention/trim policy,
host ownership and device-loss handling still need work before production adoption.

### Point-count changes: resident state can survive replacement storage

The [capacity experiment](#/point-capacity/docs/findings) runs 2,048 → 8,192 → 4,096 → 8,192 → 2,048 on
the same devices. GPU copies preserve surviving position records, absence and pinning; only appended positions
are uploaded. Registered pinned indices survive truncation in CPU metadata and are reapplied on regrowth.
Authoritative coordinate replacement is a separate operation. Neither allocation operation resets tick or cooling.

Native M3 chain, communities and star each pass three cycles: **36 paired resizes and 36 subsequent CPU-checked
frames**, with unchanged tolerances. Repeated counts return to identical tracked and luma-reported buffer bytes.
Resident application buffers at 8,192 points occupy **14.66–14.93 MiB**, with an old-plus-new peak of
**20.19–20.60 MiB**. These figures exclude driver, pipeline, texture and internal-library memory.

**Meaning for Cosmos:** a same-device transfer/ownership contract is feasible without downloading positions
inside the resize. This exact-size implementation rebuilds buffers and kernels and is slower to update than
the CPU-copy control in those observations. This does not establish the full Graph setter/transition API,
external host ownership or device recovery.

The [retained-capacity follow-up](#/point-capacity/docs/reuse) compares two GPU-bound lanes under unchanged
tolerances. Another 36 paired resizes and 36 subsequent CPU-checked frames pass. After first growth, in-capacity
updates reuse buffers/kernels and preserve the prefix without any GPU copy: local completion medians fall to
**0.6–2.7 ms**, compared with **19.0–21.7 ms** for rebuilding. Shrink retains the larger **14.66–14.93 MiB**
footprint at 2,048 points instead of releasing it to **3.64–3.71 MiB**; these are explicit application buffers.

Frame order is balanced per point count, with both GPU lanes timed. First-frame ranges overlap, but an
eight-frame warm-star follow-up measures **27.20 ms rebuild versus 15.14 ms retained** with identical
position/force bits and broad ranges. This is one evolved workload, not a general frame-speed conclusion.
Profile GPU stages and ordering effects before adopting the policy or increasing star size; update-latency
gains alone do not establish a production frame budget.

### Weighted springs: Cosmos semantics can run through luma compute

The [weighted-link comparison](#/weighted-links) uses the production Cosmos spring and integration GLSL
as its WebGL baseline. WebGPU reproduces the two ordered directional passes with stable CSR adjacency;
each direction integrates before the next starts. It covers degree bias, square-rooted weights, directional
rest-distance samples, duplicates, self-loops, pinning, absent neighbors and the collision rest-length floor.

**Meaning for Cosmos:** a graph-specific force can run through luma `Kernel` and storage buffers, with
`RenderKernel` drawing points and links from the resulting positions. Floating-point atomics are not needed.
The CPU reference and GPU regressions check both forces and both position substeps, including connectivity
replacement and resource growth. Earlier native Apple checks cover short hub-heavy trajectories in the
raw prototype. The corrected luma baseline passed native 100k-star snapshots at ticks 1 and 10,
but lost its context at tick 18 in standalone Chrome on the M3.

**Limit:** preserving Cosmos's adjacency-order dependence leaves each hub's gather serial. CSR is built on
the CPU when links change, and replacement explicitly resets the demo. Incremental updates, long-term
convergence, complete force composition and performance across devices remain unproven. The
[historical topology sweep](#/weighted-links/docs/performance) used an incorrect WebGL baseline:
both directional programs used the maximum total degree, unlike production Cosmos. Its apparent
speedups cannot support a migration decision. The baseline now uses luma `Model` and `UniformStore`
with independent directional bounds, alongside WebGPU `Kernel` and `RenderKernel`.
New native timing comparisons remain necessary. The corrected 100k-star failure occurred without
rendering or GPU queries, during the completion-fence wait; its GPU cause remains unresolved. This is
a lab execution limit, not proof that the complete production Cosmos engine has the same failure.
The [native investigation summary](#/weighted-links/docs/context-loss) preserves the historical
production v9 comparison: both sample sets passed in v9, while the v10 WebGL baseline had mixed
results, including an invalid-operation error and a Metal execution failure/context loss. Sample source
alone did not explain the failures. The temporary production debug tools have been removed and this
investigation is parked. Native v10 WebGL stability remains unresolved; failed runs cannot support
performance claims. This is not evidence of a WebGPU failure. The lab retains its CPU correctness checks.

### Numerical precision: manageable, but part of the migration contract

Dense inputs exposed accumulation error and a one-ULP cutoff difference. The current tested kernels meet
the existing acceptance thresholds, including exact neighbor counts at checked targets. The broader precision
comparison passed **72 initial and 18 evolved checks** across both variants.

**Meaning for Cosmos:** changing the GPU execution model does not require accepting looser correctness by default.
Numerical stress tests must accompany the port, especially for cancellation, coincident points and force boundaries.

**Limit:** sampled force checks and short trajectories do not prove long-term layout stability or all-device
behavior. Each production force needs an appropriate reference, error budget and convergence/quality assessment.
[Precision evidence](#/neighborhood-forces/docs/precision).

### Performance: promising choices, no engine-level verdict yet

On the tested native Apple GPU, an alternative local-force traversal reduced a dense 65,536-point complete
experimental tick from about **170 ms to 156 ms** with a 32×32 grid. Some smaller configurations instead became
**14–15% slower**. Both variants preserved the tested tolerance.

**Meaning for Cosmos:** algorithm and data-distribution choices matter; WebGPU alone does not choose the fastest path.
The dense result remains too slow for an interactive frame budget and concerns a local-force workload, not the
complete Cosmos engine. [Performance tradeoffs](#/neighborhood-forces/docs/precision-cost).

[Performance Lab](#/performance-lab) supplies matched rendering and reduction comparisons. Its synchronized
completion times include CPU/API overhead; the neighborhood experiment additionally measures GPU timestamps.
Keep those metrics distinct when comparing results. We still need complete-engine frame, update and memory measurements
against WebGL on representative graphs. [Timing methodology](#/performance-lab/docs/methodology).

## 4. How ready is the luma side?

The production engine declares luma `~9.3.0` peers. The experiments use a pinned `10.0.0-alpha.4` package family.
That is an experimental dependency choice, not an approved production version.

All experiments now use luma resource and execution APIs, including `Model`, `UniformStore`,
`Kernel`, `RenderKernel`, passes, readback, fences and optional `QuerySet` timestamps. Diagnostics and
tests follow the same boundary. Simulation and drawing share resident position buffers where required.
The grid uses a small clear kernel because this alpha has no command-encoder buffer-clear API.

This establishes direct luma integration paths for the isolated workloads. Historical native-API timings
need new measurements after this migration. It does not yet establish
that the resource, shader and scheduling APIs cover Cosmos's complete needs, especially host-owned devices,
device loss, incremental updates and reusable command plans.

| Decision still required | Demonstration needed |
| --- | --- |
| Which exact luma version and package set? | Build and run the representative Cosmos workload with compatible packages and host integrations |
| Which buffer/view abstractions should Cosmos use? | Share state across compute and rendering; exercise updates, resizing, limits and ownership |
| Should Cosmos adopt `GPUCommandGraph`? | Compare direct encoding and a reusable plan for the same workload, including setup, encoding cost and lifecycle |
| Which supplied primitives can replace custom code? | Compare their semantics, precision, capacity behavior and performance with Cosmos's requirements |
| Can supplied layouts replace Cosmos force code? | Demonstrate equivalent intended behavior, including weighted links and the chosen long-range model |

The reviewed [command-graph API](https://luma.gl/docs/api-reference/experimental/gpu-core/gpu-command-graph)
provides a candidate for organizing compute, render and copy work. It does not itself solve force complexity.
The reviewed [graph-layout APIs](https://luma.gl/docs/api-reference/experimental/gpu-graph-layouts) describe
models that differ from Cosmos's requirements: the documented exact spring model ignores edge weights, and
the spatial approximation uses a flat grid rather than a hierarchical Barnes–Hut tree.

Those APIs merit evaluation, not assumed adoption. Check actual exports and behavior in the selected package
version; documentation for a newer release is not evidence that the pinned alpha provides the same API.

## 5. The journey from feasible primitives to a ready library

```flow
Primitive feasibility · Demonstrated in experiments
luma integration · Validate resource and execution contracts
Cosmos simulation · Global forces, links and stable layouts | Cosmos renderer · Visuals, picking and interaction
Complete library · API, updates and host integration
Production readiness · Correctness, budgets and supported devices
```

### Milestone 1 — Prove the luma integration path

Run a resident compute-to-render workload through the intended luma APIs. Exercise buffer sharing,
ping-pong state, capacity changes, device loss and borrowed resources. Compare setup, CPU encoding and GPU
cost with the native-handle baseline.

**Ready to proceed when:** we have an exact dependency choice and an ownership/data-layout contract that
supports ordinary simulation and rendering without routine full-position CPU copies.

### Milestone 2 — Demonstrate Cosmos-equivalent graph simulation

Finish validating the hierarchical many-body path, combine it with weighted links,
then compose center, gravity, attractors,
mouse interaction, collision and integration. Preserve intended force order, damping/cooling, pinning and
coordinate behavior. If an approximation changes the layout model, define and evaluate that change explicitly.

Use the existing Cosmos behavior and small exact references to check individual forces, then evaluate
multi-step trajectories and convergence on sparse, clustered, dense, disconnected and high-degree graphs.

**Ready to proceed when:** representative graphs produce acceptable layouts with all required forces enabled,
within an agreed numerical and quality budget. A fixed-radius particle demo is not sufficient evidence.

### Milestone 3 — Demonstrate complete rendering and interaction

Cover point shapes, strokes, images, transitions, highlighting and order; link widths, curves, arrows and styles;
and picking, hover, dragging, selection, tracking and overlays. Validate view transforms, clipping and pixel ratios.
This work can progress alongside simulation once the shared data contract is established.

**Ready to proceed when:** matched WebGL/WebGPU examples and interaction tests cover the required visual behavior,
including picking agreement with what is actually drawn.

### Milestone 4 — Preserve the Cosmos library contract

Validate typed-array ingest, configuration/defaults, invalid or absent data, stable indices, dynamic point/link
updates, resizing, readiness, pause/resume and destruction. Identify any unavoidable public API differences.

Verify host-owned devices and render passes, exposed position resources and deck-layer integration using the
actual supported backend combinations. A WebGL texture interface cannot be assumed to map directly to WebGPU storage.

**Ready to proceed when:** the complete backend passes public API and embedding tests, and intentional changes
have clear upgrade guidance. Resource lifetime and device-loss handling must work beyond an isolated demo.

### Milestone 5 — Establish the production envelope

Define the graph sizes, distributions, visual features and interaction workloads Cosmos must support, with
explicit frame-time and memory budgets. Compare WebGL and WebGPU at equivalent output quality. Include startup,
updates, complete frames, latency tails, readback and peak memory—not only isolated force throughput.

Validate native GPUs and browsers in the intended support matrix. Reduced coverage is acceptable, but capabilities,
limits and unsupported-device behavior must be explicit. Optional timing features must not become runtime requirements.

**Ready to switch when:** correctness, layout quality, rendering and API behavior meet the agreed contracts;
performance and memory meet the target budgets; supported devices are tested; and release/upgrade guidance is ready.

## 6. Which experiments most improve our confidence next?

| Priority | Experiment | Migration question it resolves |
| --- | --- | --- |
| Extend | Weighted-link compute-to-render path through luma | Can its demonstrated resource contract handle shared ownership, device loss and live updates? |
| Extend | Weighted springs at larger sizes and over longer trajectories | Can ordered hub gathers and state-preserving topology updates meet the engine budget? |
| Demonstrated in a bounded slice | [Resident tick, timing and state-preserving updates](#/resident-layout/docs/timing-updates) | GPU bounds and composed forces avoid routine readback; measured cost and update semantics now have native evidence |
| Demonstrated in a bounded slice | [Controlled GPU stage profiling](#/gpu-stage-profile/docs/method) | Frozen replays isolate stage costs and normal/profile timing; no consistent large retained-buffer penalty was reproduced |
| Demonstrated in a bounded slice | [Ordered hub springs](#/hub-springs/docs/acceptance) | GPU-batched controls identify a provisional M3 cutoff and repeat gains on final geometry; the candidate stays opt-in |
| Demonstrated in a bounded slice | [Ordered grid aggregation](#/cell-aggregation/docs/findings) | Membership reuse plus a bounded sort improves validated larger normal frames; source-order sums and CPU gates remain unchanged |
| Demonstrated in a bounded slice | [Production layout gates](#/layout-acceptance/docs/findings) | Corrected near-field arithmetic resolves the dense-community tick; production cutoff and combined optimizations pass selected 100/300-tick trajectories with unchanged gates |
| Further performance work | Stable cell membership and occupancy-dependent routing | Can CSR/sorting remove full-source scans without changing addition order or regressing sparse inputs? |
| Demonstrated in a bounded slice | [Production settings](#/layout-acceptance/docs/production) | Staged sampling/variation controls, state-preserving cutoff changes and selected 5,000-tick adaptive runs pass unchanged checks |
| Next acceptance step | Matched production WebGL and independent layout quality | How do identical inputs, random samples and sampling decisions compare, and do layouts retain useful geometry over long schedules? |
| Next simulation features | Center attraction, then remaining forces | Do grouped reductions, attractors and collision preserve their production order and behavior? |
| Next scaling step | Adaptive samples and parallel hierarchy construction | Can the same approximation scale without serial dense-cell work? |
| Demonstrated in a bounded slice | [Point-count changes and buffer cleanup](#/point-capacity/docs/findings) | Surviving records transfer on the GPU; same devices and count-dependent footprints survive repeated cycles |
| Demonstrated in a bounded slice | [Retained capacity and kernel reuse](#/point-capacity/docs/reuse) | In-capacity updates are cheaper locally; more idle memory is retained and GPU-frame timings remain order-sensitive |
| Next resource step | Retention/trim and ownership policies | Can the measured update/frame work fit a practical memory budget, and can a host safely own the device? |
| Supporting | Refined gravity cost and a bounded larger-star cost check | Can the strict precision reference scale affordably, and which arithmetic policy should production use? |
| Alongside simulation | Links, richer points and picking from shared GPU state | Can Cosmos render and interact correctly without transferring all positions back? |
| Then | Combined engine workload on multiple native GPUs | Is the whole migration practical for the intended users and graph sizes? |
| Supporting optimization | Occupancy-dependent traversal and spatial locality | Which implementation choices improve complete frames once semantics are correct? |

Further optimization of the local-force experiment is useful, but it does not answer the largest remaining
readiness questions. The next major evidence should connect **actual Cosmos graph behavior** with **the luma
WebGPU integration path**.

Automated native regression runs are available again: a quoted-string error in the test configuration had
stopped the browser before test collection. Restoring the runner does not establish cross-device coverage;
record the actual adapter and browser for every new result.

## 7. How to use this readiness assessment

Open an experiment from the linked capability above to inspect its behavior, findings and reproduction instructions.
Use identical inputs and settings when comparing approaches; export JSON for local measurements. Record the tested
implementation, GPU/browser and workload so an observation is not mistaken for a portable guarantee.

As new evidence arrives, update the capability's demonstrated scope, remaining gap and milestone acceptance result.
The goal is a defensible decision about moving Cosmos—not a count of finished demos. Lab implementation and contributor
instructions live separately in [Lab architecture](#/architecture).
