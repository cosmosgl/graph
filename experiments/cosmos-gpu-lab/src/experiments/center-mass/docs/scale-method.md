# M3 center-force scale study

## Question

On the current Apple M3 machine, how far can the candidate's actual recursive
WebGPU center reduction and center-force shader run, and what do their isolated
costs look like as the number of points grows? One million points is a required
milestone, not an assumed device limit.

## Workload and checks

- Start at 8,192, 65,536 and 100,000 points; continue to one million, two million
  and beyond while the current implementation and the machine permit it.
- Use deterministic float32 positions in an offset, asymmetric distribution.
  Every point is present and one in 101 is marked pinned. The center includes
  pinned points. The accompanying boundary/mask test separately includes absent
  NaNs, all-absent inputs, signed values and workgroup boundaries.
- Compare the same uploaded coordinates with a JavaScript double-precision sum
  and the existing WebGL float-blend reduction. The CPU sum is a mathematical
  control, not an exact-real guarantee for all possible inputs.
- Report count equality and the high/low aggregate's bit equality to the
  float32-rounded CPU sum. Compare the first 64 forces to the existing scalar
  float32 reference with its unchanged absolute 2e-5 and relative 3e-5 tolerance.
  A sample does not establish correctness for all forces or inputs.
- A diagnostic linear-force candidate uses the same high/low center. The
  current shader computes a direction from the angle and multiplies it by
  distance; algebraically this is the center-minus-point vector multiplied by
  alpha, strength and 0.01. Compare every candidate force against the current
  shader under the same numerical tolerance, and compare the first 64 against
  the scalar reference. Floating-point operations differ, so equivalence in real
  arithmetic is not a claim of identical results. Separate small fixtures check
  pinned, absent, all-absent, coincident and non-unit-strength cases.
- These numerical checks stay separate from practical visual quality. A static
  preview of readback, or finite results, does not prove an acceptable moving
  layout. Pin/absence integration semantics and complete trajectories need their
  own tests. No subjective visual pass is assigned automatically.

## Timing

Use luma.gl 10.0.0-alpha.15 on a non-fallback WebGPU adapter. Capture actual
browser, visibility, adapter and device limits. Keep the tab visible; suspend
the older demo and other GPU work. Perform two warmups and seven samples for
each variant, with one operation per sample. GPU timestamp queries measure the
resident recursive reduction, current force and linear candidate separately. Input
creation, uploads, readback and WebGL are outside those intervals. Report all
samples and unavailable or invalid timers; do not substitute zero.

WebGL's number is elapsed time for a blend and synchronous readback, and is not
comparable to an isolated GPU timestamp. The candidate writes into GPU buffers;
its center is read only for validation and the preview. The preview itself uses
a sample drawn on the CPU, not a WebGPU-rendered graph. This does not measure
full-frame latency or frame intervals.

The linear shader is an opt-in diagnostic candidate only. It does not replace
the default combined-layout force or establish production readiness.

### Computing the center once

Compare two versions of that same linear force. The control divides the GPU
sum by the count in each point invocation. The candidate writes the average to
the same GPU buffer in the final reduction workgroup, then each point reads that
average. It retains the original aggregate separately and adds no dispatch or
CPU readback between the reduction and force. Test both reduction modes and
reused buffers with empty, all-absent, pinned, masked and signed fixtures around
workgroup boundaries. Require exact counts and unchanged aggregate bits; compare
every force under the existing tolerance and record any differing force bits.

For the M3 scale timing, use the same deterministic offset distribution and
8,192, 65,536, 100,000, one million, two million and 4,194,240 points. Alternate
the variant order across three warmup pairs and eleven measured pairs. Each
sample batches four operations and records GPU timestamps separately for the
force alone and for the complete reduction plus force. Report paired differences
and their range; timing is not an end-to-end frame-rate result. All validation
readbacks happen outside timed intervals. Use `LAB_CENTER_ONCE=1` with the visible
browser and exact-source snapshot requirements below. A live measurement
is exploratory unless its exact source is retained.

The optional `LAB_CENTER_ONCE_FRAME=1` run uses frozen community graphs with
8,192 and 16,384 points, one pin and one absent point. It alternates the two
linear-force variants for three warmup and eleven measured pairs, timing the
prototype's complete simulation and draw on the GPU. Every resulting frame's
positions and forces are checked under the existing tolerance, using the
existing exception for matching NaN coordinates only when explicitly absent;
absence, pin and flags are checked exactly. A failed check or
invalid timer makes the timing summary unavailable; this is not a measurement
of interactive frame intervals or million-point graph behavior.
For the existing 200-tick independent-trajectory check, set both
`LAB_CENTER_TRAJECTORY=1` and `LAB_CENTER_ONCE_TRAJECTORY=1` to compare the two
linear variants while retaining their strict position and discrete-state checks.

The current shader dispatches force workgroups in one dimension, stores the
aggregate count as float32 and has device buffer-binding limits. The study
reports the lowest of those current limits before allocation. It is an
implementation/device limit, not a universal hardware limit. Stop after an
error or an unusually slow operation and keep completed rows. Buffer sizes do
not describe total browser or GPU memory consumption. A boundary run can set
`LAB_SCALE_COUNT` to the reported maximum; the opt-in test verifies that one
point above that bound is rejected before allocation.

## Reproduction and boundaries

In [Measure center-force cost](#/center-mass?case=center-measurements), enter comma-separated counts and run
the study, then export the JSON. For a repeatable timed capture, retain a clean
source revision or exact source snapshot, rebuild generated controls beforehand,
and run the opt-in `scale.test.ts` with `LAB_CENTER_SCALE=1`,
`LAB_NATIVE_VISIBLE=1`, `LAB_SOURCE_REVISION`, `LAB_SOURCE_SNAPSHOT` and a
unique `LAB_ARTIFACT_RUN`. Raw captures belong in the ignored `captures/`
directory. A visible browser and non-fallback device are required; incomplete or
interrupted results remain incomplete.

The current integrated graph prototype independently guards inputs at 16,384
points, and the combined-graph fixture builder at 32,768. Those are code
boundaries, not measured M3 limits. Its other forces, links, drawing,
interaction, memory and center-off/on full-frame cost must be tested separately.
The scale study does not change the historical 8,192-point demo or approve a
million-point graph or production migration.

The separate optional frame-cost test uses the existing combined-layout study:
a frozen 8,192-point chain by default, 32 repulsion samples, center strength 1, two warmups
and seven paired center-off/on samples per backend. Its timer includes the
prototype's simulation passes and draw on the same frozen input; it is not a
measurement of interactive frame intervals. The original numerical gates still
control whether its timing summary is accepted. The test also records the
prototype's response to a 16,385-point graph.
Set `LAB_SCALE_COUNT=16384` to test the existing guard's upper boundary.

For a separate trajectory study, run the refined and linear WebGPU forces on
independently evolving 512- and 8,192-point community graphs for 200 cooling
ticks, with the same initial positions, links, one pinned point and one absent
point. Retain strict pointwise comparisons, finite-position checks, exact flags,
pin and absence checks, point displacement and spring mismatch at ticks 1, 10,
50, 100 and 200. Capture a matched-view image at the final 8,192-point tick for
human inspection. Neither a single still image nor these two fixtures establish
quality across all layouts or scales. Enable it with `LAB_CENTER_TRAJECTORY=1`;
use `LAB_CENTER_LINEAR_FRAME=1` to select the candidate in the frame-cost test.
