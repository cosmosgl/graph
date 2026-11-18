# Representative viewer findings

**The small explorer works, but its responsiveness is not accepted.** In the wider
window, one running pick took **100.4 ms**, exceeding the unchanged 50-ms target.
Both measured frame windows, exact-identity checks and sampled CPU pixel audits pass.
The earlier production interior-color failures remain rejected separately.

**Follow-up:** one planned four-block investigation at a narrower size did not
reproduce the stall. Its 160 picks and 1,200 frame intervals passed, but no cause
or fix was established. The [new finding](#/pilot-viewer?section=study-finding-picking-latency)
retains the source, local evidence and expanded reproduction instructions.

Recorded **18 November 2026** on the user's Apple M3, in the visible inline browser.
The reported WebGPU adapter was Apple, `metal-3`, `fallback: false`, Chromium 157.
The adapter and a nonempty rendered canvas were verified before each window. No
standalone browser or software adapter was substituted.

## Fixed scope and measured windows

The [first pilot contract](#/pilot-viewer?section=doc-scope) selected this dataset,
workload and interaction sequence before evaluation: 34 Karate Club members,
78 weighted links, default corrected core forces, uniform six-pixel circles, seed
29471 and 5,000-tick cooling. Each run reset the graph, advanced 60 warmup ticks,
applied Fit and measured 300 evolving complete frame intervals. Validation readbacks,
builds and tests were outside the timed windows.

| Measurement | Narrow window | Wider window |
|---|---:|---:|
| Displayed canvas, CSS px | 656 × 369 | 961.20 × 540.67 |
| Logical viewport, CSS px | 656 × 369 | 961 × 541 |
| Attachments, device px; DPR | 1,312 × 738; 2 | 1,922 × 1,082; 2 |
| Complete intervals within 33 ms | 300/300 (100%) | 298/300 (99.3%) |
| Frame median / p95 / maximum, ms | 16.7 / 16.8 / 17.6 | 16.7 / 17.5 / 33.3 |
| Maximum paused pick, ms | 17.3 | 19.7 |
| Maximum running pick, ms | 17.1 | **100.4 — Fail** |
| Maximum controlled drag feedback, ms | 16.8 | 17.4 |
| Exact IDs/camera, drag pin, pause/resume, resize | Pass | Pass |
| Sampled CPU audit | 2,102 samples; zero failures | 2,093 samples; zero failures |

The interaction sequence uses 20 paused picks, 20 running picks on a temporary
pinned target, and 20 controlled drag moves. It is a repeatable diagnostic, not a
claim that every free-moving member is easy to acquire. CPU audits found no interior
ID/color failures or invisible picks under the unchanged geometric boundary and
2/255 interior color rules. These samples do not establish complete mask parity or
erase the separate matched-production color failures.

Both runs remain evidence. The wider run was declared as an additional window, not
a controlled test of width alone; it does **not** establish that width caused the stall.

## Where the slow request waited

The wider run's slowest request returned the correct member ID, 33. Its existing
runtime phase measurements were:

| Phase | Time |
|---|---:|
| Pick request through readback | 3.3 ms |
| Selection highlight through frame completion | 4.3 ms |
| Completion through next animation opportunity | **92.8 ms** |
| Total recorded feedback | **100.4 ms** |

The largest recorded delay follows highlight completion. This is evidence about
where the feedback proxy waited, **not proof of a GPU bottleneck or of a browser
bug**. The capture reports the page visible. Physical display scanout was not measured.
The next step is one bounded investigation of this wait and the running frame loop,
with these phases retained. Do not remove the final wait or loosen 50 ms to create a pass.
The earlier 68.2-ms failure is still unexplained; this is a new event, not a diagnosed
replay of the old one.

## Actual exploration

After the narrow window, native pointer input demonstrated:

- Picking member 16, then running the layout and changing circles to degree sizes.
- Picking and dragging hub 0 while running; the hub and its incident links moved.
- Locating member 0, then following the neighbor button to member 1 while preserving
  running state. The inspector correctly showed 16 neighbors / total weight 42 for
  member 0 and 9 neighbors / weight 29 for member 1.
- Pausing, fitting, panning and zooming; then resuming and resetting the graph to
  34 members / 78 links with uniform sizes and selection cleared.

Three successful native pick requests returned IDs 16, 0 and 0 in 10.7, 10.4 and
19.0 ms. Two attempts at a moving target hit background; another background request
was intentional panning. Those are retained as background results, not successful
target acquisitions. Native drag motion was visually verified, not separately timed;
the controlled drag sequence supplies the latency measurements above.

Post-update audits checked 2,129 samples after degree sizing, 2,141 after camera
exploration and 2,150 after reset, with zero sampled ID/color/visibility failures.
The inspector uses CPU topology and refreshes every 100 ms; its text refresh is not
included in the GPU highlight feedback proxy. Lookup and neighbor buttons use known
IDs directly and therefore supply no GPU picking evidence.

## Decision and reproduction

| Decision | Current verdict |
|---|---|
| Strict production compatibility | **Rejected:** retained matched-production interior-color failures; not rerun or waived here |
| First-slice usability | Bounded exploration works, but **responsiveness fails** in the wider window |
| Full migration readiness | **Not ready:** unsupported options, full API/host coverage, larger workloads and unresolved failures remain |

Continue using the viewer as an investigation tool. Reopen the bounded latency
question before claiming this supported workflow passes; do not expand to large
graphs or reopen unrelated raster investigations to avoid this finding.

Open this experiment, keep the tab visible at a fixed width, and use **Assess this
pilot**. Then perform the native exploration sequence in the contract and export
JSON locally. Reload after changing window width. Both raw captures were retained
locally; this page records their findings, not machine-dependent JSON in the repository.

Focused native regressions passed **11 tests across three files**, covering the
pilot's gates/metadata/lookup/reset/destruction and shared navigation/coverage records.
An initial test read the reset report before asynchronous validation completed; the
test now waits for that report. No rendering assertion or acceptance gate changed.
During that rerun the original inline tab became unreachable to automation; a fresh
visible tab in the same inline browser recovered access. Adapter and rendering were
verified again before the wider measurement.

## Four-block latency investigation

**The delay did not recur, so its cause remains unknown.** On 18 November 2026,
we ran the declared normal → traced → traced → normal sequence exactly once.
No runtime optimization, production change or acceptance change was made.
The question was whether surrounding frame work or callback delays could explain
the long wait after highlighting a selection.

The visible Codex inline browser on the user's M3 reported Apple WebGPU,
`metal-3`, fallback false, Chromium 157, with luma 10.0.0-alpha.15. The API did
not report the exact adapter model. The graph was visibly rendered before timing.
This canvas was **627 × 352.6875 CSS pixels**, logically 627 × 353 at DPR 2,
with 1,254 × 706 attachments. This is a new, narrower control, **not an exact
replay** of the historical 961 × 541 logical failing window. Width was not varied
within this sequence, so it does not establish a width effect.

Each block reset the same 34 members / 78 links and original settings, advanced
60 warmup ticks, applied Fit, and measured 300 evolving intervals. Each frame
window lasted about five seconds. Then the unchanged interaction sequence checked
20 paused picks, 20 drag moves, camera/lifecycle behavior, 20 running picks on the
temporary pinned target and sampled CPU pixels. Validation stayed outside frame
timing; the pick's own readback stayed inside feedback timing. The entire sequence
ran from 11:55:03 to 11:55:32 UTC, without concurrent tests, builds or source edits.

| Block | Frame p95 / maximum, ms | Intervals within 33 ms | Paused pick maximum, ms | Running pick maximum, ms | Drag maximum, ms |
|---|---:|---:|---:|---:|---:|
| 1 · normal | 18.7 / 18.8 | 300/300 | 18.9 | 18.9 | 18.9 |
| 2 · traced | 18.7 / 18.7 | 300/300 | 22.1 | 25.3 | 18.6 |
| 3 · traced | 18.7 / 18.8 | 300/300 | 19.0 | 19.2 | 19.3 |
| 4 · normal | 18.7 / 18.8 | 300/300 | 18.7 | 18.7 | 18.9 |

Every block had **0/20 paused and 0/20 running picks above 50 ms**, exact IDs/camera,
and passing drag-pin, pause/resume and resize checks. Each sampled CPU audit
checked 2,101 samples and found zero interior ID/color failures or invisible picks.
These are bounded samples, not full-mask or production-color acceptance.

### What the trace tells us

Tracing observes calls to the existing runtime plus independent animation and
16-ms timer callbacks. It adds callbacks, allocations and promise continuations;
the two traced blocks are observation controls, not normal runtime benchmarks.
Normal blocks bracketed them. This one sequential session does not estimate
tracing overhead reliably or isolate session drift.

The slowest traced running pick was request 60 in the export, returning member 33
in **25.3 ms**: 5.2 ms through readback, 1.8 ms completing the highlight and 18.3 ms
awaiting an animation opportunity. The overlapping simulation frame spent about
0.2 ms submitting work and completed in 5.0 ms. No long synchronous frame call
explains a stall at this request; this request itself did not fail.

Across the two traced blocks, maximum synchronous frame-call times were 1.0 and
1.1 ms. Maximum observed animation-callback gaps were 19.4 and 19.3 ms; timer gaps
were 18.8 and 18.6 ms. There was no long callback gap to attribute. These observations
cannot explain an event that did not occur, exclude an intermittent application
stall, or identify a browser/OS cause. The feedback endpoint remains GPU completion
plus the next animation opportunity, not physical display scanout.

### Decision after this investigation

- **Strict compatibility:** production interior-color failures remain rejected;
  this study did not rerun or waive them.
- **First-slice usability:** all four new windows pass, but the historical 100.4-ms
  and 68.2-ms failures remain unexplained. Overall responsiveness is still unresolved.
- **Full migration readiness:** not ready; this bounded local result adds no feature,
  device or larger-workload acceptance.

The next useful control is **one declared four-block sequence near the historical
wider canvas size**, with actual dimensions recorded and the same 50-ms endpoint.
Do not infer a width cause or repeat until passing. If the failure again does not
recur, retain the unresolved finding and choose a bounded evidence-collection plan;
do not invent a renderer fix from passing runs.

### Evidence and workflow review

The finding record retains the exact clean measured revision. Source state was
identical before and after measurement. The original export, per-block analysis,
declared protocol, dependency/environment record and checksums remain in the local
ignored capture directory named by the finding. Raw measurements are not committed.
Follow [the recipe](#/pilot-viewer?section=doc-agent-recipe) to reproduce the procedure;
matching timing is not promised.

This trial used the finding workflow for a new question in an existing experiment.
It produced a completed but inconclusive investigation, rather than turning a
passing run into a fix claim. The result and remaining unknown are ordinary text;
agent instructions stay expanded. The live graph remains above the record, and a
focused UI regression checks the finding and both document links when GPU setup
fails. All **53 focused tests across five files passed in the inline browser**,
including the new publication checks. Browser automation initially disconnected
after the capture was exported; the final checks completed after reconnecting,
without repeating the measured investigation. Typecheck, targeted lint, build and
finding-schema checks pass. No other browser was substituted.
Schema validation checks required information, not the correctness of the
interpretation. Another agent has not independently rerun this investigation.
