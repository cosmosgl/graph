---
source: Local investigation
recorded: 2026-11-18
device: User's Apple M3 Mac; visible Chrome 157; WebGPU reports Apple metal-3, non-fallback
scope: Center computation for the experimental linear force; bounded frozen inputs and combined graphs
---

# Computing the center once

Calculating the center once on the GPU produced the same tested results, but
**did not show a clear speed improvement** on this M3. It remains an opt-in
experiment; the previous linear force and production code are unchanged.

The control divides the accumulated sum by the count in each point's linear
force invocation. The candidate performs that division once in the final
reduction workgroup, stores the center in a second GPU-resident vector, and
reads it in each point's force invocation. The original aggregate remains
available; there is no extra dispatch or CPU readback in the simulation path.

## Accuracy

On the same offset/asymmetric input at 8,192, 65,536, 100,000, 1 million,
2 million and 4,194,240 points, counts and aggregate bits matched exactly.
Every resulting force component was **bit identical** between these two linear
variants in this run. Separate tests covered both reduction modes, pinned and
absent points, absent NaNs, all-absent inputs, empty input, reuse, signed values
and workgroup boundaries.

The two linear variants also ran independent 200-tick community layouts with
512 and 8,192 points. At every recorded checkpoint their positions were
numerically identical, and pin, absence and flag checks passed. This does not
erase the earlier strict trajectory failure between the **refined** force and
the linear candidate; see [M3 scale findings](#/center-mass?section=center-force-cost).

## GPU timing

Visible Chrome 157, luma.gl `10.0.0-alpha.15`, timestamp queries, three warmup
pairs and eleven measured pairs. Each sample batches four operations; order
alternates. These medians time **the reduction and force together**, not a full
graph frame.

| Points | Divide per point | Compute once | Paired once − per point | Range of paired differences |
| ---: | ---: | ---: | ---: | ---: |
| 1,000,000 | 2.431 ms | 2.447 ms | +0.006 ms | −0.201 to +0.105 ms |
| 4,194,240 | 8.392 ms | 8.359 ms | −0.144 ms | −0.346 to +0.717 ms |

The paired ranges cross zero. These observations do not establish a speedup
or a regression. The compiler may already optimize the repeated operation, or
other work may dominate; these measurements do not distinguish the causes.

A separate alternating full-frame test covered frozen 8,192- and 16,384-point
community graphs with the other prototype forces and drawing enabled. At 8,192,
median GPU times were 11.684 ms per point versus 11.764 ms once; the paired
difference range was −0.592 to +4.048 ms. At 16,384, they were 14.019 versus
14.208 ms; the paired difference range was −0.343 to +0.658 ms. All recorded
frame comparisons passed their existing numerical and exact-state checks.
These are frozen GPU-frame timings, not interactive frame intervals.

The initial frame run retained as `captures/center-once-frame-m3-20261118/`
marked two matching NaN force components for an explicitly absent point as
failures, making its summaries unavailable. The replay uses the existing
absence-aware comparison, which allows matching NaNs only for explicitly absent
points, and separately checks pinned and absent positions and flags exactly.
No tolerance for present points was changed.

## Reproduction and limits

The actual WebGPU adapter reported Apple/metal-3 and `fallback: false`, but did
not expose its chip model; the same session's WebGL renderer identified Apple
M3. The isolated scale data and exact source/dependency snapshot are in
`captures/center-once-m3-20261118/`. The frame replay and trajectory data are
in `captures/center-once-frame-replay-20261118/` and
`captures/center-once-trajectory-m3-20261118/`; they use the snapshot in
`captures/center-once-replay-m3-20261118/`. The earlier failed frame capture
is retained separately.

These are limited workloads on one machine. They do not measure a million-point
full graph, resolve the existing 16,384-point prototype guard or change the
production migration decision. The [study method](#/center-mass?section=run-diagnostics)
describes the controls and reproduction flags.
