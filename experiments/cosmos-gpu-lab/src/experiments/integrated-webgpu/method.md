# First integrated migration: scope and protocol

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

Unsupported: curves, patterns, arrows, images, rings, transitions, link picking, collision,
clusters, attractors, mouse repulsion, automatic fit, shared host devices and recovery.
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
