**A full Cosmos WebGPU backend is technically credible. We have a bounded integrated prototype through public luma APIs; production adoption still needs complete feature, integration and performance acceptance.**

Roadmap reviewed **19 November 2026**. Measurement dates remain on the linked experiment pages. The production engine remains WebGL with luma `~9.3.0` peers. The lab pins the luma `10.0.0-alpha.15` package family. This page describes current readiness and the next decisions. Experiment pages preserve the detailed investigations, controls and reproduction instructions.

The destination is **full WebGPU simulation and rendering sharing resident GPU state**. Reduced device coverage is acceptable. The current WebGL engine supplies the behavioral reference.

**Research workflow:** run focused checks on the current machine's native GPU.
The lab is not a production package and has no required CI checks or manual
software-GPU workflow. Keep measured failures and original gates visible without
requiring a green broad suite to continue. Historical cross-device results retain
their scope; further device coverage is a later migration decision.

## 1. Where we are

Use the [validation workflow](#/validation-workflow) and [numerical research report](#/numerical-research)
to distinguish accuracy, legacy arithmetic compatibility, behavior, quality and cost. Every example
declares its comparison contract. [Precision diagnostics](#/precision-diagnostics) compares analytic
gravity and bounded cancellation sums without changing historical gates or selecting a production
policy. Independent candidate integration, runtime adaptation and agreed quality budgets remain
acceptance work.

### Million-point Four corners on M3

The [million-point study](#/million-graph?section=doc-cell-field-m3-result)
ran 200 ticks with one million points and 999,999 links in native Chrome on
the M3. The lab prototype rebuilt the hierarchy on the GPU each tick and ran
gravity, repulsion, link springs and basic drawing at 480 × 340. Timings
cover submission through GPU completion and end before browser presentation.

| Starting layout | Per point median / p95 | Four corners median / p95 | Layout difference at tick 200 (p95) |
| --- | ---: | ---: | ---: |
| Evenly spread | 47.1 / 58.0 ms | **38.4 / 61.6 ms** | 0.78 px |
| Two dense clusters | 46.3 / 56.6 ms | **36.9 / 53.5 ms** | 0.40 px |

Each timing is the median of the corresponding statistic from three runs.
Layout difference measures displacement from the per-point layout for 4,096
tracked point IDs in the same camera. The median tick fell by about 9 ms on
each input. The evenly spread run had a higher p95, the starting clusters
dispersed quickly, and frozen probes still found force jumps across dense
cell edges.

### Persistent dense communities on M3

A second [million-point study](#/million-graph?section=doc-dense-communities)
used 999,990 local links and pinned community anchors. All free points stayed
in their original neighborhoods at ticks 50, 100 and 200. Four corners passed
the declared one-pixel layout check, with **0.58 px** settled p95 displacement
and **0.013 px** excess p95 motion at late cell crossings.

| Native replay | Per point median / p95 | Four corners median / p95 |
| --- | ---: | ---: |
| Normal run A | 55.0 / 75.9 ms | **50.1 / 63.0 ms** |
| Normal run B | 55.6 / 68.4 ms | **50.1 / 66.9 ms** |

A separate instrumented replay measured **13.35 → 8.10 ms** median repulsion
and roughly **30 ms** for drawing on both paths. The instrumented p95 moved
from 67 to 70.3 ms. Much of the slow candidate tick was outside the recorded
stages.

An expanded profile timed the three GPU index passes separately. On the
Four corners path, their combined median was **0.88 ms** overall and **1.05 ms**
in the slowest ten ticks. Drawing rose from **28.36 to 37.79 ms**. A fresh
unprofiled comparison measured **53.6 → 48.3 ms** median and **70.7 → 58.2 ms**
p95. The earlier 30.8 ms unexplained tail did not recur. In this replay,
drawing was the largest measured cost. The expanded viewer study below
tests those costs at a wider canvas with pointer input.

### Drawing and interaction on the M3

On the fully visible 961 × 541 CSS canvas at DPR 2, a frozen million-point
Fit view used **16.18 ms** for points alone, **6.96 ms** for links alone and
**25.27 ms** for the combined GPU draw. The 3× community zoom used
**8.49 ms** for both even though it still submitted the full graph.
[Drawing study](#/million-graph?section=doc-draw-cost)

The moving Lab viewer now supports pan, zoom and point picking. The dense
and high-degree workloads at **196,608 points** met the steady-frame and
pick references in two sessions. Frame gaps still grew during repeated
clicks. One pick exceeded 50 ms at 262,144 points. At one million points
both workloads updated about every **50 ms**, returned the expected IDs,
and missed the frame and pick targets. Peak sampled luma allocation was
**154 MiB**. The slow picks spent most of their time waiting to run and
redrawing the highlight. [Moving graph results](#/million-graph?section=doc-interactive-study)

### Production blockers

- **Pilot responsiveness.** The historical 100.4 ms running pick and
  68.2 ms pick still exceed the 50 ms target. The wider DPR 1 and standalone
  DPR 2 controls passed all 320 picks. Of 2,400 frame intervals,
  2,398 met the 33 ms target. The original stalls remain unexplained. The 8,192-point star
  still fails its timing checks. [Pilot findings](#/pilot-viewer?section=doc-findings) ·
  [Acceptance rules](#/validation-workflow?section=first-migration-rules)
- **Force composition.** Isolated mouse repulsion, clusters and per-point
  attraction pass through 8,192 points on M3. Combined same-input stage checks
  pass, and both composed fixtures pass a local one-pixel screen over 40 ticks.
  Independent trajectories still miss strict tolerances. The larger hash
  collision path needs direct WebGL comparison and in-tick cost.
  [Combined forces](#/combined-layout?section=doc-force-composition) ·
  [Hashed collision](#/collision?section=doc-hashed-findings)
- **Rendering and interaction.** The integrated viewer retains 557
  interior color failures across two styles. All are in the link layer.
  The antialiasing candidate improves edges. Isolated point transitions
  match 12 fixed checkpoints. Interior colors, remaining styles and full
  transition and pointer integration are still open.
  [Feature inventory](#/feature-inventory) · [Link edge smoothing](#/viewer-comparison?section=doc-findings-straight-link-edge-smoothing)
- **Integrated scale.** The basic million-point viewer exceeds the frame and
  pick references with dense and high-degree workloads. Reduce drawing and
  highlight cost. Test the full force and style set, updates, presentation
  and memory on representative data. [Moving graph results](#/million-graph?section=doc-interactive-study)
- **Graph and host contracts.** Borrowed device cleanup and explicit checkpoint
  restart pass. Rectangle and polygon IDs and tracked positions match bounded
  fixtures. Full setters, synchronous read APIs, automatic recovery and deck
  integration still need a production design. Choose a shared luma family and verify the
  supported native GPU and browser matrix. [Host study](#/integrated-webgpu?section=doc-host-ownership) ·
  [Selection study](#/integrated-webgpu?section=doc-selection) ·
  [Tracking study](#/integrated-webgpu?section=doc-tracked-points) ·
  [Production checklist](#/roadmap?section=milestone-production)

```example
migrationStatus
```

The [feature inventory](#/feature-inventory) is the detailed force and rendering checklist. Each status names the demonstrated scope.

### First integrated migration: bounded pilot evaluated

The [integrated WebGPU graph](#/integrated-webgpu) now combines corrected core forces,
shared resident positions, circles, solid straight links, point picking/dragging,
pan/zoom, graph replacement, pause/resume, resize and destruction. Production remains
unchanged. It follows the [first-migration rules](#/validation-workflow?section=first-migration-rules).

Current evidence from the native M3 inline browser, with unchanged gates:

| Area | Demonstrated scope | Remaining limit |
|---|---|---|
| Core simulation + drawing | Corrected resident forces share positions with circle points and solid straight links | Not the full production Graph API or every force/style |
| Small workload timing | Repeated 1,024-community controls and normal-path cross-check pass | Earlier intermittent timing stalls remain unexplained and retained |
| 8,192 chain and communities | All four timestamp-comparison windows and later control/candidate windows pass | Early evolving windows do not establish cooled large-graph quality or all graph shapes |
| 8,192 star | Stage attribution identifies the serial incoming hub pass; ordered prefetch preserves state/colors and helps modestly | Every candidate star window still fails. Keep default `hoist`; further tuning parked |
| Cooled Karate Club | After Fit, all 34 points are visible, separate and pickable; two hub regions are readable; frame and sampled-pixel gates pass | Original whole assessment rejected by a 68.2-ms pick; fixed early camera clips half the graph; dense links are harder to trace |
| Paused picking replay | Original exported cooled geometry, 102/102 exact picks, maximum 17.5 ms; actual pointer checks 20.1–27.1 ms | The 68.2-ms event did not recur. No cause or fix established; paused replay is not whole-runtime acceptance |
| Small production/viewer comparison | Karate moving/cooled frames, running picks/dragging, style/data replacement and settled resize pass on M3; layouts look similar after Fit | Same-geometry interior color checks fail; first-slice usability is not strict production compatibility |
| Representative pilot viewer | 34 members. The wider DPR 1 control peaks at 32.3 ms. The wider DPR 2 standalone Chrome control peaks at 20.0 ms while running | The historical **100.4 ms running pick** in the inline browser remains unexplained |
| Interaction/lifecycle | Point drag/pin release, camera, replacement, pause/resume, resize and destruction in the lab runtime. Separate selection and host checks pass | Full setters, asynchronous readback contracts, deck integration and automatic recovery still need acceptance |

Detailed evidence stays with the experiment:
[earlier adverse runs](#/integrated-webgpu?section=doc-findings-final-run-and-repeatability-limit),
[small-graph controls](#/integrated-webgpu?section=doc-findings-small-graph-pacing-investigation),
[8,192 GPU timing](#/integrated-webgpu?section=doc-findings-gpu-timestamps-at-8-192-points),
[bounded star investigation](#/integrated-webgpu?section=doc-findings-star-bottleneck-and-one-bounded-candidate),
[cooled readability](#/integrated-webgpu?section=doc-findings-cooled-karate-club-readability-and-exploration),
and [picking replay](#/integrated-webgpu?section=doc-findings-bounded-cooled-picking-replay).
Later passes do not replace prior failures.

**Three verdicts:** strict compatibility remains **not established**;
first-slice usability has **bounded local evidence**, with rejected workloads and
unresolved stalls; full migration is **not ready**. Faint nonzero opacity below 0.02,
advanced styles and automatic framing remain explicitly unsupported.

The 100.4 ms event included 92.8 ms after highlight completion. Both wider
controls used the historical 961 × 541 logical dimensions. The standalone
Chrome replay also matched the 1,922 × 1,082 attachment at DPR 2. Neither
control reproduced the historical stall.
[DPR 1 replay](#/pilot-viewer?section=study-finding-pilot-wider-control) ·
[DPR 2 replay](#/pilot-viewer?section=study-finding-pilot-wider-dpr2)

## 2. Current numerical and layout boundary

Keep three contracts distinct, with the **existing tolerances unchanged**:

| Contract | What it answers | Current boundary |
| --- | --- | --- |
| Stage and whole-tick correctness | Does the implementation agree with the reference from the same starting input? | Same-input stages pass on both new composed fixtures. The hashed collision candidate matches its CPU model |
| Independent layout behavior | Do evolving layouts retain matching coordinates and useful geometry? | The composed and Four corners layouts pass local pixel screens. The composed strict coordinate failures remain |
| GPU cost and memory | Can accepted behavior fit the intended engine workload? | Bounded frozen cost and synchronized million-point ticks are measured. Complete-engine budgets and peak memory remain open |

### Core composed simulation

The [production layout gates](#/layout-acceptance/docs/findings) validate the inclusive 4,096-point exact/grid cutoff, state-preserving crossings and selected combined optimizations. The [production-settings study](#/layout-acceptance/docs/production) adds 32 starting samples, spring variation `[1, 1.2]`, GPU occupancy and bounded adaptive decisions, including selected 5,000-tick runs. Sampling is therefore partially demonstrated; full Graph scheduling and allocation policy remain open.

The [matched layout study](#/matched-layout/docs/findings) independently evolves production GLSL, strict WebGPU and CPU. Its center-off force sequence records 12 M3 runs and 11,200 ticks, with zero measured WebGPU pointwise drift and passing frozen checkpoints/probes. WebGL retains scalar failures while layout scores remain close. The shared CPU-derived sampling tape and selected graph families bound that result.

The earlier [center-enabled long runs](#/matched-layout/docs/center) use the original float32 reduction tree. Their drift and timings remain historical baseline evidence; the later high/low correction does not retroactively change those measurements.

The [additional-force study](#/combined-layout?section=doc-force-composition)
composes [mouse repulsion](#/mouse-repulsion), [clusters](#/cluster-attraction)
and [per-point attractors](#/point-attractors) in production order. Paused
mouse behavior, masks and pins pass. The first failing ticks pass every
same-input stage replay. Independent positions pass 16/16 at 256 points and
1/8 at 8,192 points. Both graphs pass the separate 40-tick visual screen,
with maximum projected position and motion differences under 0.015 px. The
added forces raise median GPU time from 7.83 to 8.33 ms at 8,192 points,
with basic drawing and frozen inputs.

### Center and collision

The [center correction](#/collision/docs/findings) retains a high/low position sum through every reduction level, then supplies the existing float32 aggregate. It fixes the observed dense center sensitivity without a CPU intermediate or tolerance change. Double-single precision has a bounded numerical contract; this is not a universal exact-sum guarantee.

The [original native-arithmetic study](#/collision/docs/trajectories) remains a historical control: 1,699/1,700 WebGPU tick gates and 271/1,700 trajectory gates pass, with substantial accumulated drift. Its corrected center stages were already locally exact, which localized the next issue to collision. The WebGL control retains 1,589 tick gates and 217 trajectory gates. Those failures remain visible.

The original cooled-star counterexample is tick 5: two whole-tick coordinates fail after the first native collision difference. The [targeted collision correction](#/collision/docs/precision) combines refined squares/roots/divisions with separately rounded per-neighbor contributions. It passes the reconstructed input and all **1,700 tick and trajectory gates** in the repeated independent matrix, with zero measured pointwise drift from CPU. The force law, CPU reference and numerical tolerances remain unchanged.

The correction adds roughly **0.84–0.89 ms** to initial dense-star GPU frames and **0.48–0.63 ms** on cooled geometry at 512 points/four passes. Both controls, all 512 timing captures and queries pass. This is bounded M3 evidence with minimal drawing. The collision demo defaults to the checked candidate.

Above the 4,096-point cutoff, the [hash and slot pilot](#/collision?section=doc-hashed-findings)
matches all 18,874,368 selected and empty slot entries from its production-semantics
CPU model across nine passes at 4,097 and 8,192 points. It covers a dense bucket
with overflow, a hash tie, pins and missing points. Direct comparison with
the production GLSL slot path, timing and integration are still open.

Agree layout-quality targets for overlap, stress, motion, stability and representative data. Those targets supplement the numerical checks. They do not relabel a failed coordinate comparison as passing. Cooled stillness alone does not establish force balance or an overlap-free layout.

## 3. The ordered research plan

This is the current task order. A closed investigation can retain failing cases; it does not close the associated feature or milestone. Detailed methods, alternatives and counterexamples live on their experiment pages.

### Recommended next work

1. **Reduce drawing and highlight cost at scale.** Use the frozen Fit and
   zoom controls to test drawing fewer overlapping opaque points while
   preserving visible color and picking order. Test the cost of highlighting
   a picked point without drawing the full scene again. Rerun the moving
   dense and high-degree workloads with the same timing references.
2. **Bring the composed forces into a representative interactive M3 workload.**
   Extend the passed one-pixel screen to deeper zoom and more graph shapes.
   Retain the strict failures and use same-input replay to diagnose any
   visible layout change.
3. **Resolve the viewer API and color gaps.** Profile link paint at the
   remaining interior witnesses. Decide how production serves readback to
   selection and tracking callers. Run the host integration against a single
   luma family before approving a production switch.

```example
journeyPlan
```

### Retained rendering evidence

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

The **17 November M3 faint-alpha replay** completes the bounded link check:
72 straight and 72 curved cases preserve original colors and have zero invisible
frame/source picks. Curved color-face picking passes all 72 full-frame CPU/GPU
comparisons; straight picking passes 64/72, retaining four blended threshold-edge
and four hard-edge failures. The older geometry matrices keep their verdicts.
See [straight-link evidence](#/straight-links?section=doc-method-faint-alpha-picking-replay-17-november-2026)
and [curved-link evidence](#/curved-links?section=doc-method-faint-alpha-picking-replay-17-november-2026).

The **17 November M3 endpoint-gradient comparison** preserves each backend's
production gradient colors and source visibility in all 40 straight and 64
curved rows. Full-frame acceptance remains **30/40 straight** and **28/64 curved**;
matched solid controls retain the same row verdicts and mask/ID error counts.
Endpoint alpha, missing/default channels and solid-mode restoration pass focused
checks. See [straight gradients](#/straight-links?section=doc-method-endpoint-gradients-17-november-2026)
and [curved gradients](#/curved-links?section=doc-method-endpoint-gradients-17-november-2026).

The **17 November M3 dash/dot study** retains exact original colors but passes
only **14/24 straight** and **4/24 curved** full-frame cases; the four curved
passes have zero opacity. Latest replays report zero invisible frame/source
picks in both backends, with a passing 12-check straight dash-wrap repeatability
probe. Two earlier runs reported 12 invisible WebGL picks; the cause remains
unresolved. Native/CPU pattern mask and color boundaries remain rejected.
See [straight patterns](#/straight-links?section=doc-method-dash-and-dot-patterns-17-november-2026)
and [curved patterns](#/curved-links?section=doc-method-dash-and-dot-patterns-17-november-2026).

The **bounded pattern audit** captures four isolated witnesses through public
luma APIs. The straight dash tie is coverage `0.5` in WebGL versus
`0.4999998212` in WebGPU, with equal phase. At the three curve witnesses,
ordinary GPU colors agree while the CPU differs; separate float probes are
not always faithful reconstructions of ordinary paint. Explicit fine/coarse
WebGPU diagnostics return the same sampled values. All four focused tests
pass, including the existing solid curve diagnostics, but no rendering row is
reclassified. See [pattern boundary findings](#/curved-links?section=doc-method-pattern-boundary-audit-17-november-2026).

**First slice now evaluated; rendering follow-up remains bounded.** Retain
these exact-boundary results as compatibility evidence. Deeper rendering
investigation resumes only when it affects pilot usability or the corresponding
feature enters the full-migration scope.

### Parked investigations

“Parked” means further investigation is stopped for the first attempt. It does
not mean accepted, fixed or deleted. The demos and strict checks remain available.
Review this register before claiming full readiness; some items will need deeper
investigation. Reopen earlier whenever an integrated workload exposes a practical
problem. Passing the first slice must not silently close these items.

Picking latency remains a production blocker. The pilot records the
100.4 ms request with phases and the follow-up controls.

| Investigation | Why stop now / retained result | Reopen condition before full readiness |
|---|---|---|
| [8,192-point integrated star](#/integrated-webgpu?section=doc-findings-star-bottleneck-and-one-bounded-candidate) | Ordered prefetch improves measured cost but all star windows remain rejected; keep `hoist` | Large hubs are required by the pilot, or before approving the full workload envelope |
| [Straight-link hard edges, caps and fractional raster](#/straight-links) | Exact coverage ties and original-color failures remain; no further pixel-perfect work scheduled | Boundary displacement exceeds the pilot rule, thin links vanish, picking fails in practice, or stricter compatibility is required |
| [Curved links and dash/dot boundaries](#/curved-links) | Four-pixel diagnostic is bounded; fine/coarse switching did not explain curve failures; earlier intermittent dash picks remain unexplained | Curves/patterns enter scope; verify motion, actual source visibility and color before deciding whether deeper primitive/derivative replay is needed |
| [Point fractional/polygon boundaries](#/point-styling) | Rejected native masks and color-preservation alternatives retained | Circle pilot shows a practical defect, or additional shapes require acceptance |
| [Exact faint-alpha / stored-alpha picking](#/point-styling) | Prototype closes selected visibility cases, but dense per-source passes remain costly; historical source-byte failures retained | Pilot picking is incorrect/slow, or images/translucent dense overlap enter scope; practical visibility is never waived |
| [Ribbon compute generation](#/ribbon-generation) | Stopped without adoption; cost and color problems retained; keep the vertex path | Integrated profiling identifies curve generation as a meaningful bottleneck |
| [v10 WebGL 100k star context loss](#/weighted-links/docs/context-loss) | Parked native baseline failure; cannot support timing comparisons | Such a baseline is needed for the declared workload or similar instability appears in the supported path |
| [Larger collision integration](#/collision?section=doc-hashed-findings) | The isolated hash and slot route passes the CPU model through 8,192 points. WebGL GPU parity and timing are still open | Compare the original slot shader, integrate the candidate and measure collision cost on dense inputs |

Arrows, advanced states, full transition scheduling and production host integration
remain open. Use the feature inventory to track isolated evidence and the
production gap per feature. Review retained failures and validate any alternative
or agreed behavior change before approving full migration. [Feature inventory](#/feature-inventory)

## 4. luma decisions still open

All experiment GPU operations use public luma APIs. The lab enforces this boundary for implementations, diagnostics and tests. Future comparisons should use public luma paths; historical native-handle timings are not a required implementation baseline.

| Decision | Evidence still needed |
| --- | --- |
| Production version and package family | A compatible pinned set running the representative engine and supported host integrations |
| Buffer/view and ownership model | Complete Graph setters, picking, capacity changes and automatic recovery. The bounded host test verifies borrowing and cleanup |
| Direct encoding or reusable command plans | Matched setup/encoding/GPU cost and lifecycle; `GPUCommandGraph` remains optional |
| Supplied primitives or custom kernels | Actual exports in the chosen version, Cosmos semantics/precision, capacity and cost |
| Production arithmetic policy | Accepted force composition and layout behavior at an affordable cost across supported devices |

The Lab's 10.0.0-alpha.15 pin supports the tested compute and host paths.
The installed production Graph and deck layer need luma 9.3. A deck.gl v10
trial on one shared luma version is the next dependency check. The upstream
deck guide lists v10 as the release targeting the luma v10 transition.
[Host findings](#/integrated-webgpu?section=doc-host-ownership) · [deck.gl release guide](https://deck.gl/next/docs/whats-new)

Compare any supplied layout with Cosmos's weighted springs and long-range
force model before choosing it for production.

## 5. Evidence to retain and its limits

| Evidence | What it contributes | Important limit |
| --- | --- | --- |
| [Reductions](#/scalable-reduction), [global center](#/center-mass), [spatial grid](#/spatial-grid) | Compute primitives, GPU-resident aggregates and variable occupancy | Whole-graph behavior and full graph scalability require separate validation |
| [Global repulsion](#/many-body), [hierarchical repulsion](#/many-body-grid), [repulsion trajectories](#/repulsion-trajectories) | Exact/approximate force semantics, precision controls and drift | Same-input agreement does not guarantee independent coordinate agreement |
| [Weighted links](#/weighted-links), [combined layouts](#/combined-layout) | Ordered topology, force composition, cooling and precision reference paths | Selected settings/counts; historical failing controls remain documented |
| [Resident layout](#/resident-layout/docs/dataflow) | Bounds, simulation and minimal drawing without ordinary position readback | Validation checkpoints synchronize; the renderer and force set are incomplete |
| [Million-point Four corners](#/million-graph?section=doc-dense-communities) | GPU hierarchy, native repulsion and basic drawing on three million-point workloads on M3 | Slowest ticks, high-degree workloads and interactive viewer acceptance remain open |
| [Point capacity](#/point-capacity/docs/findings), [retained capacity](#/point-capacity/docs/reuse), [host ownership](#/integrated-webgpu?section=doc-host-ownership) | Same-device prefix transfers and updates, borrowed device cleanup and explicit restart | Retention/trim, full Graph ownership and recovery, and total driver memory remain open |
| [Selection](#/integrated-webgpu?section=doc-selection), [tracked points](#/integrated-webgpu?section=doc-tracked-points) | Exact bounded IDs and position snapshots from asynchronous readback | Public synchronous APIs, latency at scale, pointer and label scheduling |
| [Point transitions](#/point-styling?section=doc-transition-findings) | Exact same-count position, fill, size and exit comparisons | Count changes, link transitions and full rendering and scheduling |
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

## 7. Future directions

### Optional postprocessing package

**Exploratory idea, recorded 17 November 2026.** Let applications add soft glow,
fading trails and user-authored image effects through a separate package. Cosmos
would draw the graph into a GPU texture; the package would process that texture
and compose the displayed image without ordinary CPU image readback. Effect
shaders, temporary textures and effect ordering would belong to the optional
package. Its name and public API are undecided.

The first experiment should compare the unprocessed graph with reduced-resolution
glow and one custom shader. Check picking, transparent backgrounds, sharp edges,
resize/DPR changes and cleanup; measure added GPU time and memory at representative
viewport sizes. Decorative glow should preserve the original picking geometry;
effects that move pixels need an explicit picking policy. Selection-specific
effects need an additional mask or ID input.

Host-owned rendering can use the existing `drawToRenderPass` boundary. A convenient
attachment to the normal Graph loop still needs a render-target and composition
integration design. Previous-frame effects also need history invalidation and
frame scheduling. This idea is outside current migration acceptance scope and
does not establish an implementation commitment or a performance improvement.

### Named shader hooks and external effect packages

**Exploratory idea, recorded 17 November 2026.** Let an external package make
individual points pulse in brightness or give links custom shading during the
existing draw. Cosmos would expose named shader hooks and documented inputs;
extensions would supply shader snippets, typed parameters and optional resources.
Their code would be assembled into the drawing shaders only when enabled.
Postprocessing would remain a complementary way to process the resulting image.

Start with point/link RGB hooks that preserve opacity and geometry. A candidate
point hook would run after base-color transitions and before greyout/hover
styling. Extension ordering, color space, input types and coordinate units need
explicit contracts. Shape, size, opacity and display-position hooks would need
separate picking, selection, bounds and culling contracts before acceptance.

The following is a proposed API sketch, not an available export or configuration:

```ts
const pulse = createShaderExtension({
  id: 'pulse',
  animated: true,
  uniforms: { speed: { type: 'f32', value: 2.0 } },
  hooks: {
    'point:rgb': {
      glsl: `
        float phase = frame.time * effect.speed + float(point.index) * 0.2;
        rgb *= 0.85 + 0.15 * sin(phase);
      `,
    },
  },
})
// Proposed attachment: new Graph(container, { extensions: [pulse] })
// Proposed parameter update: pulse.setUniforms({ speed: 4.0 })
```

Cosmos would supply mutable RGB, a read-only point index and elapsed time in
seconds, and generate the parameter bindings. Authors targeting both backends
would provide GLSL and WGSL implementations; missing backend support should report
an actionable error. A packaged factory could expose only options such as speed
to application users. The example declares animation so rendering can continue
while the layout is paused.

The first prototype should demonstrate a static tint and animated RGB pulse.
Verify unchanged output when disabled, transitions and interaction styling,
picking, deterministic extension composition, parameter updates without shader
recompilation, compilation diagnostics, per-graph isolation and cleanup. Measure
added GPU cost and confirm animation stops scheduling frames when removed. Use
public APIs in the pinned luma version; source assembly alone is not a rendered
prototype. This idea is outside current migration acceptance scope; API names,
package boundaries and implementation timing remain undecided.
