# Investigate the wait after a pick

## Question and fixed plan

**Why can a running pick wait longer than 50 ms after its highlight has completed?**
The original 100.4-ms request included 3.3 ms through readback, 4.3 ms completing
the highlight and 92.8 ms awaiting an animation opportunity. These phases
locate the delay; they do not identify its cause. The earlier 68.2-ms failure remains.

Plan declared **18 November 2026**, before this investigation's measurements.
Use the existing Karate Club pilot, not a new experiment or production renderer.
Keep shaders, forces, geometry, colors, acceptance rules and the feedback endpoint
unchanged. No optimization candidate is selected in this first attribution study.

Run **one four-block sequence**: normal → traced → traced → normal. Do not repeat
until a passing run appears. Each block resets the 34 members / 78 weighted links,
seed 29471, uniform six-CSS-pixel circles, corrected core arithmetic, ordered
`hoist` springs and 5,000-tick cooling. Keep the visible browser width and DPR fixed;
record the actual displayed and attachment dimensions. Each block uses the existing
assessment: 60 warmup ticks, Fit, 300 evolving intervals, 20 paused picks, 20 running
picks on its temporary pinned target, 20 drag moves, camera/lifecycle checks and
sampled CPU pixels. The existing sequence performs drag checks before running picks.
The normal blocks bracket the traced blocks to expose large observation overhead
or session drift; four sequential blocks cannot distinguish every confounder.

**Gates:** at least 95% of frame intervals within 33 ms, full measured feedback
within **50 ms**, exact IDs and unchanged pixel rules. Separate normal-path results
from traced results. No validation readbacks occur inside the frame window; the
pick's own readback belongs inside feedback timing. A completed block can fail.

## What tracing adds

`latency.ts` temporarily wraps the existing runtime's `frame` and `pick` methods.
It records entry, synchronous submission return and promise completion, plus
independent animation callbacks and 16-ms timer callbacks. Each pick span names its
index in the exported `feedback` array; that array retains the original phase times.
No native GPU access or new GPU work is introduced. Tracing adds callbacks,
allocations and promise continuations, so its cost must not be treated as normal
runtime performance. The methods and timers are restored in cleanup.

Read these observations cautiously:

- A long synchronous frame span overlapping the wait points toward application
  work, but does not identify the expensive shader or driver operation.
- Animation and timer gaps together show a wider callback-delivery stall; they
  cannot alone separate main-thread work, browser scheduling and OS delays.
- Animation gaps with timers still arriving narrow that distinction, but do not
  prove a compositor defect. Missing traces cannot explain a normal-block stall.
- No recurrence means **cause not established**, not fixed. A trace-only failure
  needs an observation-overhead control before choosing a runtime change.

The animation callback timestamp is not physical display time. Callbacks in one
frame may receive the same timestamp despite work between them; retain callback
arrival time separately. See [HTML animation callbacks](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)
and [requestAnimationFrame timing](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
Do not subtract the final wait from the existing feedback metric.

## Prepare source and browser

Use a clean committed revision, or retain an exact source snapshot as described
in the Lab README. Record source and working-tree state before and after the run,
Node/pnpm versions and resolved dependencies in a unique ignored `captures/`
directory. Copy any required new source files, not just their names. Rebuild the
lab before timing; no builds, tests, source edits or other GPU studies during a
measured sequence. This study uses no production bundle.

```sh
pnpm --filter @cosmos.gl/gpu-lab typecheck
pnpm --filter @cosmos.gl/gpu-lab build
pnpm --filter @cosmos.gl/gpu-lab dev
```

Open `#/pilot-viewer` in the **visible Codex inline browser on the user's M3**.
Verify a nonempty canvas and the actual adapter in Live results before starting.
Record Apple/Metal and whether fallback is false; do not infer the exact model
from the WebGPU vendor alone. If native access or inline automation is unavailable,
retain the blocker; do not silently switch browsers or software adapters.

## Run and retain every block

1. Reload at the chosen stable width, record viewport and adapter, and read this
   plan. The original wider window was logically 961 × 541 CSS pixels at DPR 2;
   a different measured size is a new control, not an exact replay.
2. Choose **Investigate picking latency** once. It resets the graph automatically
   and runs all four blocks, retaining completed, failed and interrupted records.
   Keep the tab visible. A viewport/visibility change or cancellation stops the
   sequence; unfinished blocks cannot receive a completed verdict.
3. Wait for all four blocks or an explicit interruption. Do not navigate away
   during timing. UI status refresh remains part of the ordinary viewer workload.
4. Use **Export JSON** and retain the actual download in the unique capture
   directory. `latencyRuns[].blocks` identifies each block, its checks, original
   assessment and traced spans/pulses. `firstFeedback`/`lastFeedback` bound its
   requests. Failed checks do not stop subsequent planned blocks; execution errors do.
5. Save the exact source/environment context with the capture. Analyze outside
   the timed window. Report maxima and failed-request counts for paused/running
   picks separately, and align a slow traced pick with surrounding frame spans
   and callback arrivals. Keep the original raw file unchanged.

Interrupted work and missing captures are incomplete. The browser export is not
itself a source snapshot. The original historical pilot measurements have no
independently preserved exact source snapshot; do not retroactively label them
as clean-revision replays.

## Publish and review

Add one record to `pilot-viewer/agent-findings/`; files load automatically. Follow
the shared schema and the existing Precision diagnostics example. Use plain words
for the question, answer and remaining unknown. Include actual environment,
evidence location, exact clean revision or preserved modified source, and concrete
reproduction steps. `status: complete` describes completion of the declared study,
not a passing candidate or established cause. A completed study may be inconclusive.
Keep raw JSON local and concise findings in Markdown. Link `evidenceSection` to a
heading in `findings.md` and `replaySection` to a heading in this recipe.

Verify the record's meaning against the capture; schema validation only checks
its shape. Test that its result and expanded instructions are readable when live
GPU setup fails. Keep the graph near the top. Report strict compatibility,
bounded usability and full migration readiness separately. Do not convert older
experiments merely to demonstrate the format.
