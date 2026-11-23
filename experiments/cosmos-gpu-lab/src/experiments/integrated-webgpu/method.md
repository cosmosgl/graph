# First integrated migration: scope and protocol

Run these checks on the [benchmark page](#/integrated-webgpu-benchmarks).

This is a lab-owned runtime, not a production Graph implementation. It follows the
[first-migration rules](#/validation-workflow?section=first-migration-rules). Production Cosmos and all historical acceptance tests remain unchanged.

## One resident graph

```flow
Core forces · corrected arithmetic; gravity, center, repulsion, incoming/outgoing weighted springs
Shared GPU positions · the current ping-pong buffer is borrowed by drawing and picking
Circle points | solid straight links
Point interaction · one-pixel ID readback, selection, drag pin/release, camera controls
Frame completion · one GPU-completed frame in flight; next browser animation frame
```

The simulation reuses `createCombinedWebGPU`, GPU bounds, refined near/exact arithmetic,
`trig` spring precision, the order-preserving `hoist` spring optimization and high/low
center reduction. Production routing selects exact repulsion through 4,096 points and
hierarchy above it. Center strength is 0.1; the reference preset uses eight samples,
unit spring variation, gravity 0.25, spring strength 1, distance 10 and friction 0.85.
Cooling runs over 5,000 ticks. Initial coordinates and samples use the existing seed 29471.

The renderer borrows the current GPU buffer on every draw. No ordinary frame downloads
positions. It uses public luma `RenderKernel`, buffers, passes and readback APIs.
Circles have six-CSS-pixel diameter; straight links have 1.25-CSS-pixel width and 0.45
opacity. Sizes are fixed in screen space. Points support bounded per-point RGBA/size; straight links support global RGBA and width. Default styling is fixed for evaluation.
The selected point turns yellow and grows by one CSS pixel in radius, in both color
and picking. Zero-size, absent and zero-opacity points are unpickable. Pinned state is
restored after dragging. Point IDs retain input order; the last painted point wins.
Links do not participate in point picking.

Picking redraws circle IDs into a one-pixel target, with the same device-pixel center
and camera transform as the color pass. It downloads that pixel only. The inner circle
mask has coverage at least 0.5. Nonzero source alpha below 0.02 is explicitly rejected:
this bounded implementation does not claim to solve the parked faint-alpha conversion
problem. It preserves normal source colors rather than quantizing them before blending.

## Predeclared workloads

Selected before integrated evaluation on 17 November 2026:

| Graph | Points | Links | Purpose |
| --- | ---: | ---: | --- |
| Chain | 1,024 / 8,192 | 1,023 / 8,191 | Sparse connected path |
| Communities | 1,024 / 8,192 | 1,919 / 15,359 | Connected groups of sixteen |
| Star | 1,024 / 8,192 | 1,023 / 8,191 | Unpinned serial hub |
| Zachary's Karate Club | 34 | 78 | Real weighted social topology; not a large-data claim |

Karate Club uses the published NetworkX adjacency data, zero-based IDs and original
integer weights. The conversion reproduces NetworkX's undirected `add_edge` loop:
the last nonzero directed entry supplies a weight. The graph was not chosen after seeing
timing results. [NetworkX source](https://github.com/networkx/networkx/blob/main/networkx/generators/social.py),
[dataset documentation and original paper citation](https://networkx.org/documentation/stable/reference/generated/networkx.generators.social.karate_club_graph.html).
NetworkX is BSD-3-Clause; the retained fixture is the adjacency data, not its implementation.

## Measurement window

Use the visible inline browser on the M3. Record the actual adapter report, browser,
960 × 600 CSS-pixel render size and actual DPR. CSS display may be narrower in the lab
column; pointer coordinates scale to the declared render target. Verify a nonempty
rendered canvas before timing. No Linux/software-adapter substitution.

Start by checking picking and dragging on 1,024 points. Incorrect IDs, drag state or lifecycle behavior blocks scaling. A timing miss stays a failed usability gate; it does not suppress the remaining diagnostic workloads. Before each workload, replace
the graph and reset tick/alpha. Run 60 warmup frames. Download positions and fit once,
**outside** timing. Measure the next **300 evolving frames** without validation downloads.
Each frame includes CPU scheduling, force dispatches, rendering, submission, a public
luma completion fence and waiting for the next animation-frame callback. Only one
completed frame is in flight. This conservative pacing cost is included. Do not confuse
submission throughput or isolated GPU timestamps with these intervals.

After frame timing, record scale-fitted unweighted graph-distance stress (the existing
16-landmark method; all pairs on the small real graph), spring mismatch, exact screen-space
circle-overlap pairs and RMS motion. Record ticks 60 and 360, then one untimed tick 361
for residual motion. All quality values are **Measured only**; no new acceptance threshold
or claim of convergence is inferred from them. This does not replace matched WebGL/CPU
layout studies or a later settled-layout assessment.

Then pause and run 20 picks on a pixel known to belong to a visible point, clearing the
selection before each pick. Run a 20-move drag of one CSS pixel horizontally and half a
pixel vertically per move; release restores its previous pinned state. Pan 24 × 12 device
pixels and back, zoom 1.2× at the pointer and back, check paused state, step once, resize
by −16 CSS pixels and restore. Replacement and destruction have separate lifecycle tests.
Finally move and pin the last-drawn point to a 12-CSS-pixel viewport inset and run
20 more picks while the simulation evolves. Restore that point afterward. Record
paused and running latency separately; both must meet 50 ms. This stable target tests
feedback under force/render load without mislabeling motion as an ID failure.

Validation readbacks are outside the timing window; the ID readback is necessarily
**inside** picking latency.

Native feedback latency starts at the pointer event timestamp; scripted latency starts at the equivalent request (so it excludes OS event dispatch). It
includes ID readback, selection drawing and GPU completion, and ends at the next visible
animation-frame opportunity. This is a conservative browser-visible proxy, **not a physical
scanout measurement**. Scripted interactions are labeled separately from real pointer smoke
checks. Backgrounding the tab invalidates the run. Cancel keeps completed records.

## Acceptance and limits

At least 95% of the 300 intervals must be ≤33 ms. Every measured pick must reach the
feedback opportunity within 50 ms; report the median, p95 and maximum. Drag latency is
also reported against 50 ms. Do not average away missed targets.

The independent CPU audit samples 2,048 deterministic viewport pixels plus centers and
boundary probes for up to 128 points. It checks finite state, IDs and source-over RGBA8
colors. Only pixels within one device pixel of an actual circle/rectangle boundary are
excluded from strict interior color/ID comparisons. Color error outside that boundary
must remain ≤2 channel levels. Invisible picks are counted even at boundaries. Sparse
sampling does not prove every pixel passes; isolated fixtures receive exhaustive checks
in the lifecycle regression. No numerical tolerance in an existing experiment changes.

The core pilot measures gravity, center, many-body repulsion and springs.
The [composed-force study](#/integrated-webgpu?section=doc-composed-interaction)
also exercises right-button mouse repulsion, clusters, point attractors and collision.
Curves, patterns, arrows, images, rings, transitions, link picking, automatic fit,
shared host devices and recovery remain outside this viewer's scope.
Only fixed screen-space sizes and finite bounded inputs (4–32,768 points in the fixture API; measured through 8,192) are supported. Empty graphs are not yet supported. Missing features
are not implicitly ignored. Replacement prepares a new force generation on the same device and swaps it only after setup succeeds; point count and topology can both change. Data replacement is explicit; this is not the full public setter API.

Strict compatibility, practical first-slice usability and full migration readiness are
three separate conclusions. The historical source-alpha, polygon and ribbon failures
remain visible in their original experiments. A usable pilot cannot approve them.

## Small-graph pacing controls

**Profile small-graph pacing** is a diagnostic added after the first integrated run.
It fixes the workload to 1,024 communities (1,919 links), the original seed and styling,
and 960 × 600 logical pixels at recorded DPR. Three repetitions rotate this order:

```flow
RAF only · paused canvas; measure browser animation callbacks without new GPU work
Redraw · same tick-60 positions; submit points and links, await completion
Full tick · original corrected forces, drawing and completion fence
```

Each control replaces the graph, advances 60 ticks, fits once outside timing and waits
60 redraw/callback warmup frames. It then records 300 intervals. Full ticks advance
from tick 60 to 360; the two static controls retain tick 60. Quality calculations are
omitted from this diagnostic. All rendering audits and position readbacks follow timing.
Full-tick controls then perform the same 20 paused picks, 20 running picks, 20-move drag
and camera/lifecycle interaction checks. Completed rows survive cancellation; any tab
visibility loss invalidates the unfinished row, even if the tab becomes visible again.

Every interval retains the original animation timestamp difference and a separate
`performance.now()` callback-arrival difference. Optional frame tracing separates CPU
simulation submission, drawing submission, completion wait and the next-frame wait.
These are **wall-clock phases, not GPU timestamp durations**. Completion wait includes
GPU queue execution and notification scheduling. Picking records ID draw/readback,
highlight draw/completion and next-frame wait, whose durations sum to its total.
Individual phase p95 values need not occur on the same frame and must not be added.

The runtime still has one completed GPU frame in flight; profiling does not remove the
fence, change force arithmetic or relax any acceptance gate. RAF-only and redraw rows
are diagnostic controls, not simulation acceptance. Full-tick observations retain the
95%-within-33-ms, 50-ms feedback and existing sampled-rendering rules.

WebGPU completion promises report queue progress; they are not GPU-only stopwatches.
The monotonic browser clock measures when JavaScript observes that progress.
[WebGPU queue completion](https://www.w3.org/TR/webgpu/#dom-gpuqueue-onsubmittedworkdone),
[High Resolution Time](https://www.w3.org/TR/hr-time/).

## GPU timestamps on the integrated passes

**Compare GPU timestamps** measures the existing simulation pass and the existing
circle/straight-link render pass using public luma timestamp queries. The device requests
`timestamp-query` as an optional feature; ordinary frames write no queries. If unavailable,
the diagnostic reports that limitation rather than substituting a CPU duration.

Predeclared workload: 1,024 communities / 1,919 links, seed 29471, original forces and
styles, 960 × 600 logical pixels at recorded DPR. Run four reset windows in **off, on,
on, off** order. Every window advances 60 warmup ticks, fits outside timing, then measures
300 complete evolving frames. Quality calculations are omitted. The completion fence and
next-animation-frame pacing stay unchanged. Both control and instrumented windows use the
same device, with the optional feature enabled throughout.

Each instrumented frame writes four endpoints: start/end of compute and start/end of
render. Only subtract endpoints **within the same pass**, then add those two durations
for that frame. Never subtract timestamps across passes on this Metal path. The sum
excludes gaps between passes, other queue work, CPU submission, completion notification
and presentation. GPU timestamp resolution is limited; reported digits do not imply
nanosecond measurement precision. [WebGPU timestamp queries](https://www.w3.org/TR/webgpu/#timestamp-query).

Query results are mapped/read only after the 300-frame window. luma may encode GPU-side
query resolution/copies during submission; these instrumentation costs are included in
complete intervals, but are outside the measured pass endpoints. Compare on/off controls
to detect a practical regression rather than assuming measurement is free. Invalid,
negative, timed-out or unavailable results are never converted to zero GPU time.

After timing, compare final position and force bits with the first window, then perform
the existing interaction and sampled-pixel checks. The baseline establishes comparison
state; it is not an independent numerical reference. A separate regression compares
query-on/off positions, forces and rendered colors exactly, and the existing whole-tick
CPU comparison retains its tolerance. Completed rows survive cancellation; visibility loss
invalidates the unfinished row. JSON export includes individual pass durations, frame
intervals, adapter/viewport, state comparisons and interaction checks.

Do not subtract independent p95 columns to infer a notification delay. Even a per-frame
subtraction mixes different endpoints: GPU work can start before CPU submission ends,
and the completion wait includes work outside the measured passes. These observations
can identify where most work occurs without attributing every unmeasured millisecond.

## 8,192-point timestamp sweep

The **Time 8,192-point graphs** action extends the same comparison to chain,
communities and star, in that order. Declared on 18 November 2026 before evaluation:
8,192 points each; 8,191 chain/star links and 15,359 community links; seed 29471;
960 × 600 logical pixels at actual recorded DPR. The resident backend selects its
existing hierarchical repulsion at this count. The star remains unpinned.

Each graph gets its own four reset windows: timestamps off/on/on/off, 60 warmup ticks,
one fit outside timing and 300 complete measured frames. Its first window establishes
its own bitwise baseline; comparisons never mix graphs. Post-window checks retain the
same 20 paused picks, 20 running picks, 20-move drag, camera/pause/resize checks and
sampled rendering rules. Validation and query readbacks remain outside frame timing.
The original 95%-within-33-ms frame and 50-ms feedback gates are unchanged.

Every completed window records graph, actual point/link counts, repulsion route,
adapter, viewport, raw timings and checks. Cancellation retains completed windows.
A missed gate remains rejected while the remaining diagnostic windows continue; an
execution error or visibility loss interrupts the run. The existing **Compare GPU
timestamps** action now uses the selected graph/count, allowing a single fixture to be
reproduced. This adds no force, shader, color, tolerance or scheduling optimization.

## Bounded star investigation

Declared on **18 November 2026** before evaluation. **Profile star pacing** uses the
same 8,192-point unpinned star, 8,191 links, seed, camera fit, 960 × 600 logical viewport
and actual DPR as the timestamp sweep. Three repetitions rotate browser-only, redraw
and full-tick order. All reset to the same tick-60 scene; redraw holds it fixed while
full-tick evolves it. Each includes 60 redraw/browser warmups before 300 measured
intervals. Post-window rendering checks stay outside timing. Full-tick windows retain
20 paused picks, 20 running picks, the 20-move drag and all existing gates. Browser-only
and redraw are controls, never acceptance evidence for simulation.

**Profile star stages** is a separate diagnostic: normal/split/split/normal windows,
60 warmup ticks, one fit and 60 measured evolving ticks (61–120) each. Normal frames
retain the original compute/render passes; split frames put timestamps around each
existing force/integration or hierarchy stage, including the corrected center force.
There are 16 compute stages plus the same integrated circle/straight-link drawing pass.
Kernels, arithmetic, force order, alpha schedule and uniforms are unchanged. Split-pass
overhead and synchronization can change timing: these shorter windows cannot pass the
300-frame usability gate or be extrapolated to the whole cooling trajectory.

Each query pair measures only its own pass. There are 2,040 query entries in a split
window, all read afterward. Exact position, force and rendered-color bits must match
the first normal window; CPU sampled rendering uses the original acceptance rules.
Any mismatch makes attribution provisional. No validation/readback runs inside timing.
The [WebGPU timestamp-query specification](https://www.w3.org/TR/webgpu/#timestamp-query)
notes limited timestamp precision; zero-duration small stages are unresolved, not free.

The historical fifteen-stage combined-layout profiler remains unchanged and continues
to reject optional-force workloads. This integrated diagnostic explicitly adds center.
No production Cosmos code or acceptance threshold changes. Prior chain/community
passes remain controls; normal-frame evaluation must confirm any later optimization.

### One existing spring candidate

After the stage measurements identified incoming springs as the largest measured stage,
**Compare hub prefetch** was declared before evaluation: star, then chain and communities,
all at 8,192 points. Reuse the [existing ordered prefetch candidate](#/hub-springs?section=doc-acceptance)
with its provisional 1,024-neighbor threshold. Each tile loads 64 neighbors cooperatively;
one lane retains the serial velocity correction in original adjacency order. No arithmetic,
force law, colors or acceptance rules change. The default integrated path stays `hoist`.

Each graph resets for eight 60-warmup/300-measured windows: hoist/prefetch/prefetch/hoist
with timestamps **off**, followed by the same order with timestamps **on**. Every window
must match the first control's final position, force and rendered-color bits before
interaction checks. Paused/running picking, dragging, functional and sampled rendering
gates are unchanged. State/color and timer readbacks are outside frame timing. Low-degree
chain and communities are controls for candidate overhead; absence of hubs retains the
candidate's existing plain-kernel fallback. Construction and extra buffer allocation are
outside this steady-state comparison. It does not establish data-update cost or memory
scalability. The last window restores `hoist`; a candidate pass never silently changes
the default. No further candidate is part of this bounded investigation.

## Settled Karate Club assessment

Declared on **18 November 2026** before evaluation. **Assess settled Karate Club** uses
only the preselected 34-point, 78-weighted-link graph, seed 29471, existing corrected
core forces, `hoist` springs and the original 5,000-tick cooling schedule. The canvas is
960 × 600 logical pixels at the actual recorded DPR. No alternate layout, seed, solver,
style or quality tolerance is selected after observing the result.

Advance normally in the visible browser. Fit at tick 60, then hold that camera while
recording geometry at ticks 60, 360, 2,500 and 5,000. Measure complete frame intervals
for ticks 61–360 without readbacks or quality calculations. At tick 5,000, record the
original framing and sampled pixels before a deliberate manual-equivalent Fit; record
the fitted geometry too. Then measure ticks 5,001–5,300 and one untimed residual tick.
The cooling factor reaches about 0.001 after 5,000 ticks; it is not mathematically zero.
Report this as a cooled layout, not a proof of equilibrium.

Quality uses the existing stress, spring mismatch, radius, motion and exact screen-space
circle-overlap measurements. Stress uses all 561 unweighted shortest-path pairs;
topology weights still enter the simulation. Quality has no new pass threshold. Low
residual motion caused by cooling does not by itself establish readable geometry.
Keep screenshots/visual observations distinct from numerical acceptance evidence.

Outside timing, retain the actual tick-5,300 positions for reproducible exploration.
Inventory every ID present in the rendered ID attachment and pick a near-center pixel
for each. Record missing IDs and each request-to-visible-feedback duration. Then run
the existing 20 paused picks, 20 running picks, 20-move drag, zoom anchoring, pan,
pause/resume and resize checks. Restore the retained geometry after those deliberately
perturbing checks; this is an inspection reset, not simulation convergence evidence.

Audit that same geometry at DPR 1 and 2, both fitted and at 1.25× zoom with a 24/12 CSS-pixel
pan. The one-device-pixel geometric boundary, two-byte interior color budget, exact IDs
and invisible-picking checks remain unchanged. Return to the actual DPR and fitted
geometry, paused, for manual pointer picking/dragging, pan/zoom and Fit in the inline
browser. Scripted feedback includes GPU completion plus a browser presentation
opportunity, not physical scanout or OS input-dispatch latency.

Both 300-frame windows retain the 95%-within-33-ms gate. All measured picking/drag
feedback retains 50 ms. Functional/rendering passes are reported separately from
**readability: measured and visually reviewed**, **strict compatibility: not established**
and **full migration readiness: not ready**. Record limitations such as clipped points,
coincident nodes, dense links, lack of labels or inability to trace relationships;
do not change colors or hide difficult geometry to improve the verdict.

## Bounded cooled picking replay

Declared **18 November 2026** before evaluation. Use **Replay cooled picking** with
an earlier local Export JSON, or this session’s completed settled assessment.
The reader imports only the finite 34-point tick-5,300 geometry and source metadata;
imported historical results cannot become live passes. Restore it on a fresh Karate
backend, paused, with original styles, manual Fit and a 960 × 600 logical viewport
at actual DPR. Runtime tick resets to zero: this is a **frozen-geometry picking
replay**, not continuation of the captured cooling schedule or a new frame benchmark.

Before timing, inventory the ID attachment and choose the nearest pixel to each
point center. Run exactly three sweeps: IDs 0–33, 33–0, 0–33. Do not warm up picking,
discard the first request, stop on a latency miss or add repeats after observing
results. Clear selection before each request. Retain all 102 samples with expected
and returned ID, coordinates, total feedback latency and its three wall-clock
phases: ID draw/readback, highlight drawing/completion, and next animation-frame
opportunity. Their sum is the same request’s duration; these are not GPU timestamps
or physical scanout measurements. Preparation already draws the scene/ID attachment,
so the first request is not a cold-device measurement.

Exact IDs and the **50-ms maximum** remain unchanged. Missing points, interruption,
changed positions or sampled pixel failures prevent acceptance. Read positions and
validate pixels only after the sweeps; do not rerun simulation. Cancellation retains
completed samples as an incomplete, unaccepted row. A visibility loss invalidates
the row. Then check actual pointer clicks on a peripheral point and both hubs;
export these subsequent feedback samples separately from the scripted sweeps.
No build/test process runs alongside timing.

A passing replay does not explain a previous stall. Stop this bounded investigation
unless a reproducible practical failure supplies new evidence; keep the previous
whole assessment rejected and move to the production-workflow comparison.
