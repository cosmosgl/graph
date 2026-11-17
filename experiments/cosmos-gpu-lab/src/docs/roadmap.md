**A full Cosmos WebGPU backend is technically credible. We have a bounded simulation prototype through public luma APIs; production adoption still needs complete feature, integration and performance acceptance.**

Roadmap reviewed **16 November 2026**. Measurement dates remain on the linked experiment pages. The production engine remains WebGL with luma `~9.3.0` peers. The lab pins the luma `10.0.0-alpha.15` package family. This page describes current readiness and the next decisions. Experiment pages preserve the detailed investigations, controls and reproduction instructions.

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

## 3. The ordered research plan

This is the current task order. A closed investigation can retain failing cases; it does not close the associated feature or milestone. Detailed methods, alternatives and counterexamples live on their experiment pages.

```example
journeyPlan
```

### Immediate checkpoint: picking cost, then link coverage

The [stored-alpha candidate](#/point-styling?section=doc-method-stored-alpha-picking-prototype-16-november-2026)
checks actual per-point attachment alpha before composing IDs. Its five bounded
candidate/UI tests pass on M3 and Linux SwiftShader with original colors intact.
The old mathematical source-byte control still fails its two software visibility
assertions. The new CPU composition reference consumes measured per-point masks;
it does not independently predict attachment rounding.

This closes the tested visibility counterexample for a separate candidate, not
point rendering or picking acceptance. Its current implementation adds three
passes per point and reuses two full-viewport scratch targets within each request.
The [bounded cost study](#/point-styling?section=doc-method-stored-alpha-cost-16-november-2026)
passed exact outputs in all 16 M3 cases. At 1024 points with only four overlapping,
unprofiled resolver completion medians were 566 ms for WebGL and 464 ms for
WebGPU. GPU timestamp caveats prevent a pure GPU comparison.
The [filtered comparison](#/point-styling?section=doc-method-filtered-stored-alpha-picking-16-november-2026)
now passes exact IDs and original colors in all 16 paired cases on M3 and Linux
SwiftShader. At 1024 points with four overlapping, it keeps four candidates and
reduces 3073 passes to 13. M3 request wall medians (including filtering and setup)
fall from 321.3 to 21.2 ms in WebGL and 300.6 to 2.7 ms in WebGPU. Dense overlap
retains every point and remains expensive. The CPU-resident broad phase does not
yet solve GPU-resident candidate discovery or production pointer latency; those
remain open, alongside decorative rings. Preserve the unfiltered baseline and
old source-byte failures.

The [pixel-distance hover/focus overlay](#/point-styling?section=doc-method-pixel-distance-hover-focus-overlays)
clears the Linux ring-color discrepancy at the unchanged 2/255 budget: all 96
cases pass CPU colors on both M3 and SwiftShader, with maximum error 1/255.
The original Linux overlay still fails 17 cases; its control and tests remain
intact. Candidate picking IDs and pick-only color bytes are unchanged, but
corrected overlay colors differ from the old control. Eight polygon-mask rows
remain rejected. This closes a bounded color investigation, not point-feature
acceptance or stored-alpha support for decorative rings.

Then replay the shared source-byte boundary in straight and curved links before
returning to endpoint gradients, patterns, arrows and link states. Their shared
quantizer makes this relevant; it does not prove those link fixtures fail. Keep
polygon and native link raster/color blockers visible. Continue afterward with
missing forces, small Graph integration and complete-workload acceptance rather
than expanding this focused picking investigation indefinitely.

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
| [Point styling and picking](#/point-styling) | Bounded styling/image/ring studies and a stored-alpha visibility candidate on M3/SwiftShader | Historical polygon gates, actual pointer scheduling, practical picking cost and broader devices remain open |
| [Straight-link rendering and picking](#/straight-links) | Production straight ribbons, width/default/alpha/zoom/DPR/order checks and separate padded/visible ID policies; 30/40 M3 cases accepted | Ten hard/raster boundary failures, legacy ID compatibility, broader link styles, Graph integration, cost and native portability remain open |
| [Curved solid links](#/curved-links) | Production power-spaced rational ribbons, scalar triangle-strip masks and selected-source checks; 28/64 M3 cases accepted, all original colors preserved and no invisible source picks | Native mask/color boundaries remain rejected; other styles, integration, cost and portability remain open |
| [Circle rendering](#/point-rendering), [performance lab](#/performance-lab) | Initial visual parity and repeatable isolated timing | Complete renderer, interaction and engine-level speedup remain unproven |

The v10 WebGL 100k-star context-loss investigation remains [parked](#/weighted-links/docs/context-loss). Failed baseline runs cannot support performance comparisons. Bounded M3 evidence and software-browser regressions do not establish cross-device readiness.

Keep concise findings and reproduction instructions in Markdown, with environment, workload, implementation variant and acceptance scope. Raw measurement JSON remains a local export. Recorded regression-test success does not erase a numerical case explicitly reported as failing.

## 6. The migration journey

```example
journeyFlow
```

Update this page's current boundary and next exit evidence as experiments close. Keep detailed numerical history in the linked experiment pages, and lab construction/contributor guidance in [Lab architecture](#/architecture). The objective is a defensible full Cosmos → WebGPU decision.
