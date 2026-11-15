**A full Cosmos WebGPU backend is technically credible. We have a bounded simulation prototype through public luma APIs; production adoption still needs complete feature, integration and performance acceptance.**

Reviewed **15 November 2026**. The production engine remains WebGL with luma `~9.3.0` peers. The lab pins the luma `10.0.0-alpha.4` package family. This page describes current readiness and the next decisions. Experiment pages preserve the detailed investigations, controls and reproduction instructions.

The destination is **full WebGPU simulation and rendering sharing resident GPU state**. Reduced device coverage is acceptable. The current WebGL engine supplies the behavioral reference; a permanent WebGL fallback is not a requirement for the destination.

## 1. Where we are

Use the [validation workflow](#/validation-workflow) and [numerical research report](#/numerical-research)
to distinguish accuracy, legacy arithmetic compatibility, behavior, quality and cost. Every example
declares its comparison contract. [Precision diagnostics](#/precision-diagnostics) compares analytic
gravity and bounded cancellation sums without changing historical gates or selecting a production
policy. Independent candidate integration, runtime adaptation and agreed quality budgets remain
acceptance work.

```example
migrationStatus
```

**These envelopes differ.** The 8,192-point composed-force results do not include the complete newer collision-enabled workload. Larger reductions or spatial indices do not establish larger complete graph layouts. Some isolated force checks reach 16,384 points; the 32,768 scaling-harness option has not established acceptance.

The [feature inventory](#/feature-inventory) is the detailed force/rendering checklist. Status means demonstrated scope, rather than a percentage of the migration completed.

## 2. Current numerical and layout boundary

Keep three contracts distinct, with the **existing tolerances unchanged**:

| Contract | What it answers | Current boundary |
| --- | --- | --- |
| Stage and whole-tick correctness | Does the implementation agree with the reference from the same starting input? | Strong bounded evidence, including a corrected collision matrix; original failing controls stay visible |
| Independent layout behavior | Do evolving layouts retain matching coordinates and useful geometry? | Core matched and corrected collision runs have bounded agreement; broader data and quality targets remain open |
| GPU cost and memory | Can accepted behavior fit the intended engine workload? | Useful controlled measurements; complete-engine budgets and production precision policy remain open |

### Core composed simulation

The [production layout gates](#/layout-acceptance/docs/findings) validate the inclusive 4,096-point exact/grid cutoff, state-preserving crossings and selected combined optimizations. The [production-settings study](#/layout-acceptance/docs/production) adds 32 starting samples, spring variation `[1, 1.2]`, GPU occupancy and bounded adaptive decisions, including selected 5,000-tick runs. Sampling is therefore partially demonstrated; full Graph scheduling and allocation policy remain open.

The [matched layout study](#/matched-layout/docs/findings) independently evolves production GLSL, strict WebGPU and CPU. Its center-off force sequence records 12 M3 runs and 11,200 ticks, with zero measured WebGPU pointwise drift and passing frozen checkpoints/probes. WebGL retains scalar failures while layout scores remain close. The shared CPU-derived sampling tape and selected graph families bound that result.

The earlier [center-enabled long runs](#/matched-layout/docs/center) use the original float32 reduction tree. Their drift and timings remain historical baseline evidence; the later high/low correction does not retroactively change those measurements.

### Center and collision

The [center correction](#/collision/docs/findings) retains a high/low position sum through every reduction level, then supplies the existing float32 aggregate. It fixes the observed dense center sensitivity without a CPU intermediate or tolerance change. Double-single precision has a bounded numerical contract; this is not a universal exact-sum guarantee.

The [original native-arithmetic study](#/collision/docs/trajectories) remains a historical control: 1,699/1,700 WebGPU tick gates and 271/1,700 trajectory gates pass, with substantial accumulated drift. Its corrected center stages were already locally exact, which localized the next issue to collision. The WebGL control retains 1,589 tick gates and 217 trajectory gates. Those failures remain visible.

The original cooled-star counterexample is tick 5: two whole-tick coordinates fail after the first native collision difference. The [targeted collision correction](#/collision/docs/precision) combines refined squares/roots/divisions with separately rounded per-neighbor contributions. It passes the reconstructed input and all **1,700 tick and trajectory gates** in the repeated independent matrix, with zero measured pointwise drift from CPU. The force law, CPU reference and numerical tolerances remain unchanged.

The correction adds roughly **0.84–0.89 ms** to initial dense-star GPU frames and **0.48–0.63 ms** on cooled geometry at 512 points/four passes. Both controls, all 512 timing captures and queries pass. This is bounded M3 evidence with minimal drawing. The collision demo defaults to the checked candidate; native/strict controls remain available. Production precision policy and larger collision workloads are still open.

Agree layout-quality targets for overlap, stress, motion, stability and representative data. Those targets supplement the numerical checks. They do not relabel a failed coordinate comparison as passing. Cooled stillness alone does not establish force balance or an overlap-free layout.

## 3. The next work, in order

### 1 — Preserve the ring/greyout baseline and isolate polygon boundaries

The [point styling study](#/point-styling/docs/method) now covers shapes, strokes, source-byte picking, atlas packing/updates, PNG normalization, outline/hover/focus rings and greyout. Retain its production controls and reproducible findings before further changes.

The ring/greyout sweep accepts **88/96** rows. All color, overlay-ID and pick-only preservation checks pass. The eight rejections repeat the aligned polygon scene at native scale across eight effect profiles. All 144 static atlas records remain unchanged. Earlier source-texel packing passes 48/48 cases, raw-image updates pass 72/72, and production canvas plus premultiplied-bitmap → sRGB ImageData normalization each pass 8/8 PNG settings. Legacy sprite/visibility and direct-bitmap failures remain separate controls.

Time-box one focused investigation of the polygon predicates in GLSL, WGSL and the scalar reference. Keep exact masks/IDs, zero invisible picks and the **2/255** color budget unchanged. A passing color comparison cannot override a rejected mask. If this investigation does not resolve the cases, retain the counterexamples and proceed with broader feature coverage.

**Exit evidence:** a localized explanation and replayable counterexamples, plus a correction verified at the original gates if one is found. Broader codecs, colors and native devices remain open.

**Investigation outcome:** the opt-in pixel-space diagnostic removes all cross-backend ID differences in its 96-row M3 sweep, but passes **86/96** overall. Eight native rows retain CPU diamond-tie failures and two ratio-2 rows reject six changed WebGL color pixels under exact pick-only preservation. The normalized control retains **88/96**. The scalar reference, acceptance and production controls are unchanged. Keep these counterexamples and proceed to step 2; an explicit closed-polygon/reference decision and preservation fix remain separate gates. [Detailed isolation and reproduction](#/point-styling/docs/method).

### 2 — Validate production link rendering and picking

Start with production straight ribbons: endpoints from resident positions, widths, zoom scaling, colors/alpha, overlap, stable IDs and rendered/picked agreement. Minimal links in the spring experiments do not establish this contract.

Then add curved ribbons, endpoint gradients, dashed/dotted patterns, arrowheads, distance visibility and hover/focus/greyout states. Keep deterministic rendering inputs separate from evolving force differences.

**Exit evidence:** production WebGL, luma WebGPU and suitable independent references pass declared visual/ID gates for the tested link features. Transitions, occlusion optimization and pointer behavior remain explicit follow-ups.

### 3 — Complete the missing force families

Validate **per-point attractors → cluster attraction → mouse repulsion**, then compose them in production force order with the already checked forces. Include target/membership updates, missing targets, per-point strengths, pinning, cooling, coordinate transforms and paused-simulation interaction.

Global center reduction supplies infrastructure for clusters; it does not establish grouped aggregation or cluster-force behavior. The bounded corrected collision gate remains separate from these new force checks.

**Exit evidence:** production GLSL, luma WebGPU and CPU agree for isolated cases and complete small-graph force composition at unchanged tolerances.

### 4 — Exercise a small production API integration

Bring a small `GraphSimulation`/`Graph` WebGPU path together before further large-graph optimization: resident simulation, styled points and links, updates and picking using shared GPU state. Exercise typed-array ingest, defaults/invalid data, stable indices, pause/resume, reheating, resize and destruction.

Expand this into full channel/setter coverage, interrupted transitions, additions/removals, callbacks, selection and tracking. Validate borrowed devices/passes, position-resource exposure, state isolation, host picking, deck integration and device loss. The current WebGL position-texture interface needs an explicit WebGPU contract.

**Exit evidence:** a small integrated backend demonstrates the supported API, ownership and update contracts. Complete public API/embedding acceptance remains required before switching production. Document intentional public changes.

### 5 — Establish graph scalability and the production envelope

Port collision's production hash/slot route above 4,096 points. Address crowded-cell scans and hierarchy construction in global repulsion, then measure larger connected, dense, disconnected and multi-hub graphs with the accepted renderer and interactions.

The [spatial grid](#/spatial-grid), [ordered aggregation](#/cell-aggregation/docs/findings) and [hub study](#/hub-springs/docs/acceptance) provide bounded infrastructure and optimization evidence. They do not establish complete-graph scaling or portable thresholds.

Agree representative graph sizes, distributions and style/interaction workloads, with quality, frame-time, startup/update latency and peak-memory budgets. Include construction, occupancy, updates and latency tails; compare WebGL/WebGPU at accepted output quality and feature scope. Validate the intended native GPU/browser matrix and unsupported-device behavior. Optional timestamps must not become a runtime requirement.

**Ready to switch:** required forces, rendering, interaction, API/embedding, performance, memory and native portability meet their stated contracts, with upgrade guidance available. Reduced device coverage is acceptable.

## 4. luma decisions still open

All experiment GPU operations use public luma APIs. The lab enforces this boundary for implementations, diagnostics and tests. Future comparisons should use public luma paths; historical native-handle timings are not a required implementation baseline.

| Decision | Evidence still needed |
| --- | --- |
| Production version and package family | A compatible pinned set running the representative engine and supported host integrations |
| Buffer/view and ownership model | Shared compute/render/picking state, capacity changes, borrowed resources and cleanup |
| Direct encoding or reusable command plans | Matched setup/encoding/GPU cost and lifecycle; `GPUCommandGraph` remains optional |
| Supplied primitives or custom kernels | Actual exports in the chosen version, Cosmos semantics/precision, capacity and cost |
| Production arithmetic policy | Accepted force composition and layout behavior at an affordable cost across supported devices |

The lab's alpha pin is an experimental choice, not the production dependency decision. Documentation for another luma release does not establish the pinned package's behavior. Supplied layouts cannot be substituted without checking weighted springs and Cosmos's long-range force model.

## 5. Evidence to retain and its limits

| Evidence | What it contributes | Important limit |
| --- | --- | --- |
| [Reductions](#/scalable-reduction), [global center](#/center-mass), [spatial grid](#/spatial-grid) | Compute primitives, GPU-resident aggregates and variable occupancy | Whole-graph behavior and full graph scalability require separate validation |
| [Global repulsion](#/many-body), [hierarchical repulsion](#/many-body-grid), [repulsion trajectories](#/repulsion-trajectories) | Exact/approximate force semantics, precision controls and drift | Same-input agreement does not guarantee independent coordinate agreement |
| [Weighted links](#/weighted-links), [combined layouts](#/combined-layout) | Ordered topology, force composition, cooling and precision reference paths | Selected settings/counts; historical failing controls remain documented |
| [Resident layout](#/resident-layout/docs/dataflow) | Bounds, simulation and minimal drawing without ordinary position readback | Validation checkpoints synchronize; the renderer and force set are incomplete |
| [Point capacity](#/point-capacity/docs/findings), [retained capacity](#/point-capacity/docs/reuse) | Same-device prefix transfers, updates and cleanup | Retention/trim, host ownership and total driver memory remain open |
| [Controlled profiling](#/gpu-stage-profile), [hub springs](#/hub-springs), [grid aggregation](#/cell-aggregation) | Balanced timing and bounded M3 optimizations | Opt-in candidates and device-specific results do not establish a universal gain |
| [Matched layouts](#/matched-layout/docs/findings), [collision trajectories](#/collision/docs/trajectories) | Independent CPU/GPU behavior and separate geometry observations | Force combinations, arithmetic variants, counts and schedules must stay explicit |
| [Circle rendering](#/point-rendering), [performance lab](#/performance-lab) | Initial visual parity and repeatable isolated timing | Complete renderer, interaction and engine-level speedup remain unproven |

The v10 WebGL 100k-star context-loss investigation remains [parked](#/weighted-links/docs/context-loss). Failed baseline runs cannot support performance comparisons. Bounded M3 evidence and software-browser regressions do not establish cross-device readiness.

Keep concise findings and reproduction instructions in Markdown, with environment, workload, implementation variant and acceptance scope. Raw measurement JSON remains a local export. Recorded regression-test success does not erase a numerical case explicitly reported as failing.

## 6. The migration journey

```flow
Primitive feasibility · Demonstrated
luma integration · Milestone 1; resident path demonstrated, production contracts open
Cosmos simulation · Milestone 2; bounded validation | Cosmos renderer and interaction · Milestone 3; early coverage
Complete Graph API and host contracts · Milestone 4; still to establish
Production envelope and supported devices · Milestone 5; release gate
```

Update this page's current boundary and next exit evidence as experiments close. Keep detailed numerical history in the linked experiment pages, and lab construction/contributor guidance in [Lab architecture](#/architecture). The objective is a defensible full Cosmos → WebGPU decision.
