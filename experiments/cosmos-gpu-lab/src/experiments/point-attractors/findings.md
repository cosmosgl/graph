# Per-point attractor findings

**Targets and live updates work in the bounded M3 comparison through 8,192
points.** Both backends pass the existing numerical gates. The corrected WebGPU
candidate is slower than WebGL for this isolated force, so we retain it as a
correctness baseline and assess its cost when composing the remaining forces.

## Native attractor comparison

Recorded **18 November 2026**, in the user's visible inline browser on Apple M3.
The declared nine-input study ran once from clean committed source. No timing
retry or tolerance change was used to obtain a pass.

| Check | WebGL | WebGPU |
| --- | --- | --- |
| Four checkpoints and four update steps per input | 72/72 pass | 72/72 pass |
| Force from each backend's own current positions | Pass | Pass; zero sampled CPU difference |
| Integrated positions and independent CPU trajectory | Pass | Pass; zero sampled CPU difference |
| Disabled-stage positions exactly unchanged | 9/9 pass | 9/9 pass |
| Direct shared-input comparison | 18/18 WebGPU/WebGL pairs pass | Same pairs |
| Post-timing forces and unchanged positions | 9/9 pass | 9/9 pass |

The largest recorded WebGL force difference was approximately `2.38e-6`.
Its largest position/trajectory difference was `0.000244140625`, one float32
[ULP](#/vocabulary/ulp) around 2,048 in the translated case. It passes the
**unchanged** absolute-plus-relative gate; a large coordinate has a larger
relative allowance. Zero measured WebGPU difference applies only to checked
rows, not every possible input or unsampled tick.

The focused native preflight also passed missing/wrong-length channel rules,
non-finite defaults, zero strengths/alpha/coefficient, count replacement and
repeated cleanup. Those checks preceded the study and do not replace it.

## Force-only GPU cost

Per-evaluation medians and full observed ranges below come from **seven batches
of 16 frozen evaluations**, after two warmup batches. Backend order alternated.
All 126 measured timestamp batches were valid; 36 warmup batches are retained.

| Input | WebGL median (range), ms | WebGPU median (range), ms |
| --- | ---: | ---: |
| semantics/12 | 0.0388 (0.0360–0.0666) | 0.3195 (0.3195–0.3482) |
| shared-target/1024 | 0.0487 (0.0364–0.0691) | 0.3523 (0.3441–0.3604) |
| individual-targets/1024 | 0.0376 (0.0365–0.0490) | 0.3154 (0.3113–0.3482) |
| mixed/1024 | 0.0373 (0.0360–0.0754) | 0.3154 (0.3154–0.3400) |
| translated/1024 | 0.0367 (0.0361–0.0384) | 0.3441 (0.3400–0.3686) |
| shared-target/8192 | 0.0357 (0.0324–0.0397) | 0.4874 (0.3031–0.7045) |
| individual-targets/8192 | 0.0331 (0.0312–0.0388) | 0.3891 (0.3031–0.6431) |
| mixed/8192 | 0.0322 (0.0301–0.0361) | 0.3686 (0.2540–0.7045) |
| translated/8192 | 0.0322 (0.0309–0.0425) | 0.3236 (0.2458–0.6799) |

The corrected WebGPU candidate has higher medians in every tested input. Its
8,192-point ranges are wide. This short study does not separate arithmetic cost
from dispatch/backend effects or establish a stable cross-session speed ratio.
It also does not show whether these costs matter in a complete frame.

Upload, integration, drawing, CPU comparison and readbacks are excluded. Do not
compare these isolated timings directly with the **95%-within-33-ms frame** or
**50-ms picking** targets. The next composition study must measure complete
frames with the accepted forces.

## Environment and retained evidence

- WebGL: ANGLE Metal Renderer **Apple M3**; WebGPU: **Apple / metal-3**, fallback
  **false**. Both public luma timestamp APIs were available.
- Visible inline Chromium **157**, luma **10.0.0-alpha.15**. Canvas attachments
  480 × 340, displayed 304.5 × 216.27 CSS pixels, DPR 2; viewport 663 × 827.
- Raw report, plan, exact source metadata, checksums and preflight logs are local
  in `captures/attractors-20261118-sl8owzze/`. They are not repository fixtures.
  The finding record retains source provenance; use the
  [reproduction recipe](#/point-attractors?section=doc-agent-recipe) for a new run.

## Decision and remaining scope

**Stop the isolated investigation here and proceed to mouse repulsion.** We
have a bounded correctness baseline at the existing gates. Further arithmetic
optimization is deferred until complete-frame cost shows it is needed.

At the time of this isolated study, clusters and attractors were not yet part
of the integrated viewer. A later composed-force study added both. Its earlier
native pointer path failed the one-pixel screen on two 8,192-point graphs;
the corrected pointer path matched the CPU at all 340 checkpoints across five
graphs. This was a separate combined check, not evidence that the isolated
attractor caused the original failure. Complete-frame cost, live production
setters, long cooling/reheating and other devices remain open.

This result preserves the historical 68.2-ms and 100.4-ms pilot picking failures
and production-color differences. Strict full compatibility is not established;
first-slice usability retains bounded evidence; full migration is not ready.
