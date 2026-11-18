# Integrated findings

The bounded star investigation identifies **incoming hub springs** as its largest
measured stage. Ordered prefetch preserves state/colors and modestly lowers GPU cost,
but **8,192 star still fails** the unchanged frame and picking gates. Chain and
communities pass their control/candidate windows. Keep the current default and move to
settled real-graph readability with the large-star limit explicit. Earlier stalls and
all historical observations remain below; full migration is not approved.

Measured **17 November 2026**, visible inline Chromium 157 on the **Apple M3** host
(10 GPU cores), luma **10.0.0-alpha.15**. Actual luma adapter: `webgpu`, vendor `apple`,
architecture `metal-3`, `fallback: false`. The renderer name is redacted; the M3 model
comes from the host hardware report. Both the existing resident scene and the new
integrated canvas rendered successfully before evaluation.

## Three separate verdicts

| Question | Conclusion |
| --- | --- |
| Strict compatibility | **Not established.** Historical exact raster, polygon, faint-alpha and ribbon failures retain their verdicts. The new small whole-tick CPU check passes its unchanged tolerance; it does not approve the renderer. |
| First-slice usability | **Bounded local evidence.** Repeated 1,024 communities and the latest four-window 8,192 chain/communities checks pass. The 8,192 star remains rejected; earlier stalls and settled quality remain unresolved. |
| Full migration readiness | **Not ready.** Advanced styles, remaining forces, collision, host integration, recovery, broader data and the parked investigations remain open. |

## Complete frame and interaction results

The earlier quiet comparison run had **no lab build or test process alongside measurement**.
Each row follows the predeclared 60-frame warmup and 300-frame window, with corrected
forces, a 5,000-tick cooling schedule and the fixed seed. Targets were unchanged:
95% of frame intervals ≤33 ms, every measured pick ≤50 ms. Numbers below are milliseconds.
The render attachment was **1,920 × 1,200**, corresponding to the declared 960 × 600
logical viewport at DPR 2; the lab column scales its displayed canvas. This is a local
browser measurement, not isolated GPU time or a physical scanout measurement.

| Graph | Points | Frame p95 | Intervals ≤33 ms | Pick max, paused / running | Local gates |
| --- | ---: | ---: | ---: | ---: | --- |
| chain | 1,024 | 17.4 | 99.0% | 16.8 / 32.3 | Pass, bounded |
| communities | 1,024 | 16.8 | 100.0% | 17.7 / 17.1 | Pass, bounded |
| star | 1,024 | 16.8 | 100.0% | 16.8 / 32.9 | Pass, bounded |
| chain | 8,192 | 50.1 | 83.0% | 31.4 / 50.4 | Not accepted |
| communities | 8,192 | 50.1 | 83.3% | 25.4 / 34.5 | Not accepted |
| star | 8,192 | 50.3 | 57.0% | 17.5 / 54.4 | Not accepted |
| karate | 34 | 17.7 | 100.0% | 18.0 / 17.9 | Pass, bounded |

The 300-frame windows lasted 5.00–8.58 seconds. The largest frame interval was 99.9 ms
(8,192 communities); the 1,024 chain also had a 49.9-ms interval, despite meeting the
95% rule. Paused drag feedback maxima were 16.8–17.8 ms. Each row checked 20 paused picks,
20 picks during simulation, a 20-move drag, pin restoration, camera anchoring,
pause/step and resize. All functional checks passed.

The 8,192-point misses persist despite a median near one refresh interval in chain and
communities. Star has the weakest frame result. The next useful step is to separate
CPU scheduling, completion-fence pacing, corrected force cost and picking queueing in
this integrated workload. These results alone do **not** isolate the cause, prove a
WebGPU limitation or justify weakening arithmetic or latency gates.

## Final run and repeatability limit

The final run at **17:27 UTC** also had no lab build or test process alongside it.
It includes adjustable global link styling and the descriptive quality checkpoints added
after the earlier quiet run. Default colors, widths, forces and timing gates are unchanged.
Quality readbacks and CPU calculations run outside timing, but possible subsequent garbage
collection, host activity, browser scheduling and GPU queueing were not isolated. The
comparison does not establish which of these caused the deterioration.

| Graph | Points | Frame p95 | Intervals ≤33 ms | Pick max, paused / running | Local gates |
| --- | ---: | ---: | ---: | ---: | --- |
| chain | 1,024 | 66.8 | 84.0% | 33.3 / 165.6 | Not accepted |
| communities | 1,024 | 50.9 | 84.0% | 17.5 / 152.6 | Not accepted |
| star | 1,024 | 66.1 | 81.7% | 32.1 / 33.5 | Not accepted |
| chain | 8,192 | 50.9 | 48.7% | 24.5 / 199.5 | Not accepted |
| communities | 8,192 | 50.7 | 58.3% | 26.2 / 182.9 | Not accepted |
| star | 8,192 | 66.7 | 17.7% | 29.5 / 127.9 | Not accepted |
| karate | 34 | 49.9 | 91.0% | 17.6 / 17.7 | Not accepted |

Windows lasted 5.88–13.98 seconds, with a maximum frame interval of 100 ms. Paused drag
maxima were 16.9–48.2 ms. All functional checks passed; all seven rows again had zero
sampled interior ID/color failures and invisible picks. Even the 34-point real graph
missed the frame gate, so point count alone cannot explain this run. Stop expanding
scope until the small-workload timing result is repeatable. A faster rerun must not replace
the adverse observations or become the verdict by selection.

## Layout quality: measured only

These values describe ticks 60 → 360, followed by one untimed residual-motion probe at
361. Stress compares drawn distances with graph distances after fitting an overall scale;
its reduction alone does not establish a readable or settled layout. Overlap counts use
six-CSS-pixel circles and the fixed camera, including pairs outside the viewport.
Residual motion is RMS movement in world units over one tick. No quality pass threshold
has been invented. Spring mismatch and layout radius are also retained in local exports.

| Graph | Points | Stress 60 → 360 | Overlapping pairs at 360 | Residual motion |
| --- | ---: | ---: | ---: | ---: |
| chain | 1,024 | 0.906 → 0.865 | 103 | 0.0747 |
| communities | 1,024 | 0.800 → 0.704 | 970 | 0.1788 |
| star | 1,024 | 0.417 → 0.417 | 0 | 0.0109 |
| chain | 8,192 | 0.977 → 0.958 | 16,641 | 0.3137 |
| communities | 8,192 | 0.930 → 0.892 | 40,049 | 0.4170 |
| star | 8,192 | 0.423 → 0.424 | 8 | 0.0371 |
| karate | 34 | 0.381 → 0.317 | 0 | 0.1393 |

The layouts still move. The 8,192-community graph has 40,049 overlapping circle pairs;
this first frame window is not a demonstration of settled readability.

## Rendering and lifecycle evidence

All seven rows had finite state and **zero sampled interior ID failures, color-budget
failures and invisible picks**. Each audit visited 2,101–2,432 pixels, including deliberate
point-center and boundary probes. Across both runs, between 75 and 1,517 samples lay within the independently
computed one-device-pixel boundary region. Those samples do not establish strict pixel
compatibility. Dense overlap reduces how much of the painted interior a sparse audit
covers; this is explicitly bounded evidence.

The focused runtime regression checks a 1,024-point corrected whole tick against the
independent CPU oracle at the existing tolerance, shared device/positions, graph replacement
through 1,024 → 8,192 → 34 points, resumed stepping, pending-pick destruction and idempotent
cleanup. Isolated circles receive exhaustive 64 × 64 checks at opacity 0, 0.02, 0.35 and 1,
including invisible-foreground fall-through. A separate thin-link check requires the
interior span to remain painted even when a boundary allowance could otherwise hide it.

This early evolving window is **not a convergence result**. The camera is fit once after
warmup; by the final check 954/1,024 and 7,207/8,192 star points in the final run, and 17/34 Karate Club points,
remained inside that fixed viewport. Chain and communities retained all points in view.
Offscreen points agree with their coordinates rather than disappearing from the renderer,
but users need **Fit** as the graph expands. Automatic framing and readable settled real-graph
layouts need further usability/quality work before a broader first-slice approval.

## Retained failures and implementation corrections

The first running-pick preflight recorded a **50.9-ms** request and was not accepted.
A subsequent exploratory matrix overlapped the beginning of a lab build. It recorded
1,024-community frame/pick misses and running-pick maxima of **108.5, 102.7 and 118.1 ms**
for the three 8,192-point graphs. These observations are retained as adverse, partly
contended evidence; the quiet run above does not erase them or prove repeatability.

Initial integration checks also caught a WGSL reserved field name, an offscreen ID
pipeline incorrectly requiring a depth attachment, and a topology-capacity failure when
replacing a chain with more links. They were fixed before the retained matrix. Replacement
now prepares a fresh force generation on the same device and swaps it after setup;
it does not use the old in-capacity resize path for arbitrary topology growth.

Inline browser control intermittently timed out during navigation, then recovered.
All reported GPU runs still used the visible inline browser; no other browser or
software adapter substituted for it.

A later direct pointer smoke check selected and dragged Karate Club point 33, visibly
moving its incident links. Empty-space panning, wheel zoom, Run, Pause and Fit also worked
in the inline browser. These observations support the interaction wiring; they are not
additional timed-window acceptance evidence.

## Reproduce

Open [First integrated WebGPU graph](#/integrated-webgpu). Start at 1,024 points and
check picking/dragging before selecting **Evaluate declared matrix**. Keep the tab visible
and stop builds/tests while timing. Completed rows remain visible; **Export JSON** includes
raw frame intervals, adapter information and per-row checks. Captures stay local.
A functional preflight failure blocks scaling. A performance failure stays rejected but
allows the remaining diagnostic workloads to run.

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/runtime.test.ts
```

Open the printed session URL in the visible inline browser. The regression is separate
from timing and cannot silently approve a missed frame or picking target. The full
measurement procedure and unsupported options are in the scope and evaluation protocol.

## Small-graph pacing investigation

**17 November 2026, 18:33 UTC**, same visible inline Chromium 157 / Apple M3,
`apple`, `metal-3`, `fallback: false`, 1,920 × 1,200 render attachment. Canvas rendering
was verified first. No lab build/test process ran alongside measurement. The browser
window was narrower than in the earlier matrix; the render attachment remained unchanged.

The declared three-repeat, rotated-order comparison on **1,024 communities / 1,919 links**
passed every measured full-tick frame and picking gate. The earlier long stalls did
**not** reproduce. No scheduling optimization was made; this is new bounded evidence,
not a demonstrated fix for the prior failures.

| Repeat | Control | Frame p95, ms | Intervals ≤33 ms | Simulation submit p95, ms | Draw submit p95, ms | Completion wait p95, ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | RAF only | 17.1 | 100% | — | — | — |
| 1 | Redraw | 17.0 | 100% | — | 0.5 | 2.5 |
| 1 | Full tick | 17.1 | 100% | 0.6 | 0.4 | 14.1 |
| 2 | Redraw | 16.8 | 100% | — | 0.4 | 2.2 |
| 2 | Full tick | 17.2 | 100% | 0.5 | 0.3 | 14.5 |
| 2 | RAF only | 16.8 | 100% | — | — | — |
| 3 | Full tick | 17.7 | 100% | 0.6 | 0.4 | 13.9 |
| 3 | RAF only | 16.9 | 100% | — | — | — |
| 3 | Redraw | 17.7 | 100% | — | 0.3 | 2.1 |

The full-tick maximum frame interval was 17.8 ms. The browser-only control was stable,
and drawing alone had a much shorter completion wait. This narrows the likely source
of additional frame work to the simulation/queue-completion path, rather than expensive
CPU command submission. It does **not** separate GPU force execution from notification
scheduling, or explain earlier environment-dependent stalls. GPU timestamps are the
next discriminating measurement. Removing the completion fence has not been tested.

| Full-tick repeat | Paused pick max, ms | Running pick max, ms | Drag max, ms |
| ---: | ---: | ---: | ---: |
| 1 | 17.6 | 17.6 | 16.9 |
| 2 | 21.9 | 32.2 | 16.8 |
| 3 | 17.8 | 17.7 | 17.7 |

Across these picks, the largest ID/readback phase was 14.9 ms, the highlight-completion
phase 6.9 ms and next-frame wait 15.1 ms. These maxima belong to different requests;
they must not be summed. All functional checks passed. Every row checked 2,432 pixels
with zero interior ID/color failures and invisible picks; all 1,024 points were visible.

A separately declared follow-up reran **Measure this graph** for the same community
fixture, including the original quality calculations. It also passed: frame p95
**17.6 ms**, **100%** within 33 ms, paused/running pick maxima **17.7 / 33.2 ms**,
zero sampled pixel failures. Thus a good result was not exclusive to the profiling path.
One successful cross-check cannot exclude occasional garbage collection or host load.

**Decision:** this small workload is locally repeatable within this session. Keep the
prior adverse runs and the rejected 8,192 envelope. Strict compatibility and full
migration readiness remain unestablished; this does not approve every first-slice
workload or settled layout quality. Next measure actual GPU force/render duration before
choosing a pacing or solver optimization. Raw captures remain local via Export JSON.

## Actual GPU duration in the small graph

**17 November 2026, 18:47 UTC**, visible inline Chromium 157 on the Apple M3; actual adapter
`apple`, `metal-3`, `fallback: false`, timestamp queries supported. The canvas rendered
successfully before the four declared **off/on/on/off** windows. Same 1,024-community
fixture and 1,920 × 1,200 attachment; no build or test process ran during measurement.

**Simulation accounts for most measured GPU pass time.** This is useful evidence against
treating the entire earlier completion wait as browser notification overhead. The small
workload remains usable in this session; no solver or scheduling optimization was made.

| Window | Timestamps | Simulation GPU p95, ms | Drawing GPU p95, ms | Per-frame GPU sum p95, ms | Completion wait p95, ms | Frame p95, ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Off | Not measured | Not measured | Not measured | 10.8 | 17.7 |
| 2 | On | 8.520 | 0.393 | 8.847 | 11.7 | 17.7 |
| 3 | On | 11.272 | 1.638 | 11.600 | 14.9 | 17.7 |
| 4 | Off | Not measured | Not measured | Not measured | 10.7 | 17.7 |

Simulation medians were 7.274 and 8.651 ms; drawing's median was 0.328 ms in both
instrumented windows. Durations were visibly quantized in the capture. Independent
p95 values do not add: the per-frame sum is calculated before taking its percentile.

All **1,200 frame intervals** met 33 ms (maximum 17.8 ms). Paused/running pick maxima
were respectively **17.7/33.0**, **17.7/32.3**, **17.7/17.8** and **17.6/18.4 ms**;
drag maxima were 17.7–17.8 ms. Every functional check passed. All four final position and
force arrays matched the first window bit-for-bit before interaction; every row had zero
sampled interior ID/color failures and invisible picks across 2,432 sampled pixels.

Timestamped completion waits were longer and varied between windows. This experiment
found no frame/picking target regression, but does **not** establish zero instrumentation
overhead or attribute the whole difference to timestamps. GPU clock/load variation,
query resolution and notification delivery remain possible contributors. The earlier
long stalls still have no demonstrated cause or fix; all adverse evidence stays above.

**Decision:** stop small-graph timing investigation here. The bounded 1,024-community
case is good enough to continue the first migration attempt. Keep its corrected solver,
colors and pacing. Next apply a bounded GPU-duration comparison to the previously failing
8,192-point envelope before deciding whether it needs force or scheduling optimization.
Do not approve larger graphs, settled layout quality, strict compatibility or full
migration readiness from this small case. All four native runtime regressions pass,
including exact query-on/off state and color equivalence.

## GPU timestamps at 8,192 points

**18 November 2026, 04:09–04:11 UTC**, visible inline Chromium 157 on the Apple M3.
Actual adapter: `webgpu`, `apple`, `metal-3`, `fallback: false`; timestamp queries
supported. Verified the 8,192-point canvas rendered before starting. Attachment:
**1,920 × 1,200**, 960 × 600 logical pixels at DPR 2. No build or test ran alongside
measurement. This uses the [predeclared sweep](#/integrated-webgpu?section=doc-method-8-192-point-timestamp-sweep),
unchanged solver, production controls, colors, pacing and acceptance gates.

**Chain and communities pass all four local windows; star does not.** Each graph has
1,200 measured frames across off/on/on/off windows. Chain/star have 8,191 links;
communities has 15,359. All use the existing hierarchical repulsion route. This is an
extension of the measurement, not a performance fix for the earlier adverse runs.

| Graph | Window / timestamps | Simulation GPU p95, ms | Drawing GPU p95, ms | GPU sum p95, ms | Completion wait p95, ms | Frame p95, ms | Intervals ≤33 ms | Pick max paused / running, ms | Local gates |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| chain | 1 / off | — | — | — | 14.5 | 17.6 | 100.0% | 19.3 / 33.3 | Pass, bounded |
| chain | 2 / on | 13.107 | 1.376 | 13.435 | 16.2 | 17.4 | 99.7% | 16.8 / 29.8 | Pass, bounded |
| chain | 3 / on | 12.976 | 1.376 | 13.304 | 15.7 | 17.4 | 99.7% | 17.1 / 33.0 | Pass, bounded |
| chain | 4 / off | — | — | — | 15.1 | 17.2 | 100.0% | 20.6 / 30.7 | Pass, bounded |
| communities | 1 / off | — | — | — | 14.6 | 17.5 | 100.0% | 17.7 / 32.5 | Pass, bounded |
| communities | 2 / on | 12.386 | 1.442 | 12.845 | 14.8 | 18.3 | 100.0% | 18.2 / 32.9 | Pass, bounded |
| communities | 3 / on | 12.386 | 1.442 | 12.845 | 14.6 | 18.3 | 100.0% | 18.8 / 31.6 | Pass, bounded |
| communities | 4 / off | — | — | — | 14.0 | 18.2 | 100.0% | 17.0 / 26.7 | Pass, bounded |
| star | 1 / off | — | — | — | 19.8 | 35.1 | 86.7% | 18.8 / 43.0 | Not accepted |
| star | 2 / on | 15.925 | 2.294 | 17.433 | 20.3 | 49.2 | 83.7% | 18.7 / 37.1 | Not accepted |
| star | 3 / on | 15.794 | 2.359 | 17.564 | 20.8 | 49.6 | 81.3% | 18.7 / 50.6 | Not accepted |
| star | 4 / off | — | — | — | 19.5 | 35.3 | 85.3% | 18.6 / 50.2 | Not accepted |

The six instrumented windows produced valid paired GPU timestamps. Independent p95
columns do not add: the GPU sum is computed per frame before taking its percentile.
Durations are quantized; do not interpret the last decimal as timing accuracy. Query
readbacks, state comparisons and pixel audits occur outside the 300-frame windows.

All **12 final position and force snapshots** match their own graph's first window
bit-for-bit before interactions. Exact IDs, pin/release, camera, pause/resume and resize
checks pass throughout. Every sampled pixel audit has zero interior ID failures, zero
interior color failures and zero invisible picks, under the original one-device-pixel
boundary and two-byte color rules. There are 2,432 sampled pixels per chain/community
window and 2,381 per star window. All coordinates remain finite. Drag feedback peaks
at 17.6 ms (chain), 18.7 ms (communities) and 18.7 ms (star).

The star is still evolving: only 7,233–7,241 of its 8,192 point centers remain in the
fixed view after interaction checks, versus all points in chain and communities. Fit
is performed after warmup, not continuously. Passing sampled rendering is not a settled
layout/readability verdict. Interaction checks add running frames after the bitwise
comparison, so their final sampled geometry can vary slightly between windows.

**What the timings establish:** simulation dominates measured GPU pass duration. The
star's per-frame GPU sum reaches 17.4–17.6 ms at p95, compared with 12.8–13.4 ms for the
other graphs. Its completion wait reaches 19.5–20.8 ms at p95 and its frame p95 reaches
35.1–49.6 ms. Both timestamp-off star windows fail too; instrumentation alone cannot
explain the rejection. The on windows perform worse here, but fixed order and GPU/load
variation prevent attributing that difference solely to queries.

**Interpretation, not yet a measured cause:** extra star work can cross a refresh
boundary under the current one-completed-frame-in-flight pacing. These whole-pass
measurements do not identify the expensive force stage, isolate scheduling overhead,
or explain why the earlier chain/community runs stalled. Do not subtract unrelated
percentiles to manufacture that attribution.

**Decision:** retain bounded local acceptance for chain and communities and the rejected
star result. Do one bounded star control next: separate redraw cost from full-tick
cost, then identify the expensive force stage if simulation is the limiting part. Keep
the corrected arithmetic, gates and normal-frame control. Do not expand to larger counts or deep pixel debugging yet. Settled real-graph readability
remains the following integration gate. Strict compatibility and full migration
readiness remain unestablished.

To reproduce, open Diagnostics and choose **Time 8,192-point graphs** in a visible
native browser. **Compare GPU timestamps** runs the selected graph/count alone.
Use **Export JSON** for local raw samples and metadata; machine-specific captures are
not committed. All earlier failing results above remain evidence, not superseded passes.

## Star bottleneck and one bounded candidate

**18 November 2026**, visible inline Chromium 157 on the Apple M3, native `apple` /
`metal-3` / `fallback: false`; canvas rendering verified before evaluation. Same 1,920 ×
1,200 attachment, corrected arithmetic, forces, colors and acceptance criteria. No build
or test process ran alongside timing. These are the
[predeclared star controls and candidate comparison](#/integrated-webgpu?section=doc-method-bounded-star-investigation).

### Drawing alone is not the limiting part

Three rotated repetitions reset to the same tick-60 scene. Redraw holds those positions
fixed; full tick evolves them over 300 frames. This isolates the cost of an evolving
simulation workload, not identical frozen geometry throughout every mode.

| Control | Frame p95, ms across repeats | Intervals ≤33 ms | Completion wait p95, ms | Worst running pick, ms | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| RAF only | 16.8–17.7 | 100.0% | 0.0 | Unchecked | Control only |
| Redraw | 18.7 | 100.0% | 8.1–9.3 | Unchecked | Control only |
| Full tick | 50.0 | 77.3–78.0% | 21.8–24.0 | 66.1 | Not accepted |

Full-tick simulation submission p95 is only 1.2–1.3 ms. Every sampled rendering and
functional check passes, but all three full-tick repeats miss both performance targets.
Redraw completion waits are wall-clock observations, not isolated GPU drawing cost.
Do not subtract unrelated percentiles to derive notification or scheduling overhead.

### Incoming hub springs dominate the measured stage window

Four reset windows compare normal/split/split/normal passes over ticks 61–120. Both
split windows match the first normal window's position, force and color bits exactly;
all timestamps are valid and all sampled pixel checks pass. Normal simulation GPU p95
is 16.6–17.6 ms. The stage split changes pass boundaries, so the following values are
attribution evidence, not replacements for normal-frame performance.

| Stage | GPU median, ms across split windows | GPU p95, ms |
| --- | ---: | ---: |
| gravity.force | 1.245 | 1.376 |
| center.force | 1.376 | 1.507 |
| repulsion.aggregate | 1.901–1.966 | 2.425–2.818 |
| repulsion.far | 2.753 | 3.867–3.998 |
| incoming.force | 7.668–7.733 | 8.258–8.454 |
| outgoing.force | 0.000 | 0.066 |
| draw | 1.376 | 2.032–2.359 |

Other small stages have limited timestamp resolution; a measured zero is not evidence
of zero work. The incoming pass has one 8,191-neighbor hub with a serial velocity
recurrence. The profile supports trying the existing order-preserving prefetch kernel;
it does not justify changing the force law, adjacency order or arithmetic tolerance.

### Prefetch helps modestly but does not meet the star gate

The comparison ran **04:34–04:38 UTC**. Each graph gets hoist/prefetch/prefetch/hoist
with timestamps off, then the same order with timestamps on: **24 windows**, 7,200
measured complete intervals. Prefetch uses the existing 1,024-neighbor threshold and
64-neighbor cooperative tiles; serial correction order is unchanged. Every window
retains 20 paused picks, 20 running picks and a 20-move drag after timing.

| Graph / variant | Intervals ≤33 ms, timestamps off | Intervals ≤33 ms, timestamps on | Normal-pass GPU sum p95, ms | Worst running pick across all windows, ms | Local gates |
| --- | ---: | ---: | ---: | ---: | --- |
| star / hoist | 79.0–79.7% | 70.3–75.7% | 18.350–18.809 | 67.6 | Not accepted |
| star / prefetch | 83.3–85.3% | 77.7–80.3% | 17.433–17.629 | 65.8 | Not accepted |
| chain / hoist | 99.3–100.0% | 97.3–99.0% | 13.042–14.680 | 35.7 | Pass, bounded |
| chain / prefetch | 98.0–98.7% | 96.0–99.3% | 12.190–13.042 | 40.0 | Pass, bounded |
| communities / hoist | 100.0% | 99.3–99.7% | 11.665–12.583 | 47.4 | Pass, bounded |
| communities / prefetch | 100.0% | 98.3–100.0% | 11.993–12.124 | 38.6 | Pass, bounded |

Across the two instrumented windows per variant, the average of the star's per-window
GPU-sum p95 falls from 18.579 to 17.531 ms (about **5.6%**). This is a descriptive block
comparison, not a statistically established portable speedup. Timestamp-off star frame
p95 improves from 49.8–50.0 to 34.7–34.9 ms, but only 83.3–85.3% of candidate intervals
meet 33 ms. Candidate running picking reaches **65.8 ms** overall. Neither variant
passes the star gate in any window. The low-degree controls pass but their durations
also vary; GPU clock/load and notification delivery are not isolated here.

All **24 position, force and color comparisons** match the first control for their graph
bit-for-bit before interaction. All sampled rendering audits and functional checks
pass. The candidate adds no observed numerical or color discrepancy in this bounded
run. It also does not establish construction/update cost, memory scaling, full cooling
behavior or cross-device readiness. Exact three-tick regression coverage now retains
star and both low-degree controls; the longer measured runs remain local evidence.

**Stopping decision:** retain `hoist` as the default. Keep prefetch as a reproducible
candidate with a measured benefit and an unchanged rejected star verdict. Do not add
another optimization to this bounded investigation. The 8,192-point hub-heavy workload
remains outside accepted first-slice performance; earlier small-star passing evidence
is local, not a guarantee for every graph below that count. Reopen large-hub performance
when that workload is required by the pilot or before claiming full migration readiness.

**Next:** assess the preselected Karate Club graph after cooling: settled geometry,
readability, framing and exploration. Keep strict compatibility, bounded usability and
full migration readiness separate. Chain/community timing passes do not establish
settled quality, and the parked large-star failure must remain visible.

Reproduce with **Profile star pacing**, **Profile star stages**, then **Compare hub
prefetch** in Diagnostics. Each action records its protocol and preserves completed
rows for **Export JSON**. Raw machine-specific captures remain local. No production
Cosmos code or acceptance gate changes; the final comparison window restores `hoist`.
