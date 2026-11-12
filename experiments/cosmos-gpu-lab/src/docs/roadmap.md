**A full Cosmos WebGPU backend is technically credible. We have a bounded simulation prototype through public luma APIs; production adoption still needs complete feature, integration and performance acceptance.**

Reviewed **12 November 2026**. The production engine remains WebGL with luma `~9.3.0` peers. The lab pins the luma `10.0.0-alpha.4` package family. This page describes current readiness and the next decisions. Experiment pages preserve the detailed investigations, controls and reproduction instructions.

The destination is **full WebGPU simulation and rendering sharing resident GPU state**. Reduced device coverage is acceptable. The current WebGL engine supplies the behavioral reference; a permanent WebGL fallback is not a requirement for the destination.

## 1. Where we are

We are primarily in **simulation-prototype validation**, milestone 2. The basic luma execution path works, while milestone 1's production ownership and dependency decisions remain open. Rendering is at its first primitives; complete library integration and the production envelope remain ahead.

| Area | Demonstrated scope | Remaining acceptance |
| --- | --- | --- |
| luma execution | Buffers, models/kernels, passes, fences, readback and optional timestamps; resident compute-to-render and same-device resizing | Production dependency choice, host-owned resources, device recovery and lifecycle |
| Core simulation | Gravity, exact/hierarchical repulsion, ordered springs and cooling; selected composed cases through **8,192 points** | Broader inputs/weights, full scheduling, remaining forces and affordable precision |
| Center attraction | Resident reduction/force/integration; corrected high/low sum is locally exact across the recent **1,600 combined independent ticks** | Wider coordinate/device envelope and production cost policy |
| Collision | Exact all-pairs law, spring contact floor, repeated passes and independent fixed/cooled layouts through **512 points** | Broader inputs/devices, production precision/cost policy and the hash/slot algorithm above 4,096 points |
| Rendering | Circles, variable-radius collision discs and minimal straight links consume resident positions | Complete point/link styling, picking and visual/interaction parity |
| Data updates | Bounded point patches, topology replacement, prefix-preserving resizes and retained storage | Full setters/transitions, allocation/trim policy and public data contracts |
| Library and embedding | Supporting resource-transfer mechanisms | Complete `Graph` backend, callbacks, borrowed device/pass ownership, deck integration and recovery |
| Production envelope | Bounded native M3 measurements and software-browser regressions | Agreed workloads/budgets and representative native GPU/browser coverage |

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

### 1 — Broaden feature coverage

The bounded collision-arithmetic gate is closed. Start with production point styling and picking, while continuing the remaining force coverage through the same shared-state architecture:

- **Rendering:** production point shapes, per-point color/size, inside strokes and zoom/pixel-ratio rules, followed by point-ID picking. Verify that visible and pickable coverage agree before expanding link styles and interaction.
- **Simulation:** cluster attraction, per-point attractors and mouse repulsion. Validate grouped centers, membership/target updates, coordinate transforms, pinning and production force order.

These three force families remain unvalidated. Global center reduction supplies infrastructure for clustering; it does not establish grouped-force behavior. Time-box further precision investigations and keep feature coverage moving alongside them.

**Exit evidence:** production-referenced visual/interaction cases and complete small-graph force composition through public luma APIs. Use static deterministic inputs to isolate renderer behavior from evolving simulation differences.

### 2 — Establish graph scalability

Port and validate collision's production hash/slot route above 4,096 points. Address crowded-cell scans and hierarchy construction in global repulsion, then measure larger connected, dense, disconnected and multi-hub graphs.

The [spatial grid](#/spatial-grid) supplies count/scan/scatter infrastructure. The [ordered grid study](#/cell-aggregation/docs/findings) and [hub study](#/hub-springs/docs/acceptance) provide bounded optimization evidence. They do not remove every serial fallback or establish portable thresholds.

**Exit evidence:** agreed graph sizes meet full-workload numerical/quality, frame-time and memory targets. Include construction, occupancy, updates, peak storage and latency tails. Scaling a reduction alone is insufficient.

### 3 — Preserve the library and host contracts

Build the actual WebGPU `Graph` backend around the validated pieces. Exercise typed-array ingest, defaults/invalid data, stable indices, all point/link channels, transitions, pause/resume, reheating, callbacks, resize and destruction.

Validate borrowed devices and render passes, position-resource exposure, state isolation, host picking, deck integration and device loss. A WebGL position-texture interface requires an explicit WebGPU contract.

**Exit evidence:** public API and embedding tests cover the supported backend combinations, ownership and recovery. Document any intentional public changes.

### 4 — Define the production envelope and release decision

Agree representative graph sizes, distributions, styling and interaction workloads, plus explicit frame-time, startup/update latency and peak-memory budgets. Compare WebGL and WebGPU at accepted output quality and feature scope.

Validate the intended native GPU/browser matrix. Reduced coverage is acceptable; limits and unsupported-device behavior must be explicit. Optional timestamp support must not become a runtime requirement.

**Ready to switch:** required forces, rendering, interaction, API/embedding, performance, memory and native portability meet their stated contracts, with upgrade guidance available.

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
