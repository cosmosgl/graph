# Direct and workgroup repulsion alternatives

## Question

Can this M3 run the existing hierarchical repulsion without storing every
far-field contribution, and do the results remain useful? Compare the existing
stored/streamed force with direct accumulation, the bounded-chunk control, and
a new workgroup-memory diagnostic. These all use the same hierarchical force
law; none changes the separate large-grid builder.

To try the candidate, open [Workgroup repulsion](#/workgroup-repulsion) and
press **Step + validate**. The live view runs up to 16,384 points; the
million-point force run below is a separate isolated test with a prebuilt grid.

The direct candidate is the lab's existing refined far arithmetic, with each
contribution added immediately. The workgroup candidate writes one float32 XY
contribution per lane to a 64-entry workgroup array, synchronizes all lanes,
then adds it. Every lane, including absent and tail lanes, participates in the
same fixed-slot barrier loop. This is 512 bytes of declared workgroup scratch,
not an 800-byte-per-point global buffer. It may incur substantial barrier cost;
it is an experiment, not an assumed optimization.

An additional per-lane workgroup candidate uses the original variable-width
traversal and omits the barrier: each invocation only writes and reads its own
slot. This tests whether an extra synchronization is necessary for the
compiler and device to preserve the same rounded contribution. It cannot be
assumed to retain the baseline precision until checked.

[NVIDIA's N-body chapter](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda)
illustrates immediate accumulation and shared-memory techniques in an all-pairs
CUDA kernel. Cosmos uses a different hierarchy and sampling policy, so that
article does not establish correctness or performance here. The
[WGSL workgroup-memory and synchronization rules](https://www.w3.org/TR/WGSL/#workgroup-variables)
define the model used by the diagnostic.

## Method and acceptance

- Native M3, visible Chrome, luma.gl 10.0.0-alpha.15. Capture the actual adapter,
  browser and limits; use a clean revision or an exact source snapshot.
- Compare streamed, 4,096-target chunked, direct refined, and both workgroup variants
  on identical uniform and clustered frozen inputs at 8,192 and 16,384 points,
  eight samples and the precise shell. Near-field refined arithmetic and the
  cached-small builder match across lanes.
- Use the existing independent CPU grid, centroid, force and integration
  references and unchanged tolerance. Report strict CPU failures and GPU bit
  differences for every variant. Exact membership, pin/absence state and finite
  present positions remain required; CPU parity and practical visual quality
  are separate verdicts.
- For each lane, measure complete grid + force + integration GPU time with one
  operation per sample, three warmups and seven measured samples, rotating
  lane order. CPU validation and GPU readbacks are outside the timed interval.
  Retain failed strict checks: a timer may be shown as **diagnostic only**, not
  as an accepted strict candidate. Suppress timing if the same lane's repeated
  frozen output changes or timestamps are invalid. Stop a slow pilot rather than
  using an unbounded workload.
- Compare independently evolving **streamed versus direct** graphs on 8,192
  uniform and 16,384 clustered points, with pinned and absent points, springs,
  gravity, center, repulsion and cooling. Record positions, exact discrete
  state, drift and layout-quality metrics at ticks 1, 10, 50, 100 and 200, plus
  matched-view screenshots. A still image or a single fixture is not a proof
  against flicker or of quality on all graphs. Keep the earlier strict failures
  and report new strict comparison failures even when the view appears similar.
- Test workgroup-memory semantics on small bounded fixtures, including partial
  workgroups, absence, coincident points and precise/balanced shells. If its
  measured cost is too high for the larger trajectories, mark those untested.
- Additionally run the same force shader for one million uniform points using
  an independently CPU-prepared hierarchy, centroids and neighbor slots. This
  bypasses the slow GPU grid builder and the full-graph point guard. Compare
  direct and workgroup outputs for every point, and compare sampled targets
  against the unchanged CPU force tolerance. Time only the frozen GPU force
  dispatch; it excludes grid construction, integration, rendering and links.
  This isolates feasibility and cannot establish a million-point graph result.

This does not attempt a million-point complete graph. The existing 16,384-point
guard and dense-cell builder are unchanged. The neighboring
[bounded-scratch investigation](#/many-body-grid?section=doc-chunked-memory-bounded-repulsion-scratch)
contains the separate one-million-point allocation and spatial-index probes.

Use LAB_FAR_ALTERNATIVES=1 for the frozen timing and
LAB_FAR_ALTERNATIVE_TRAJECTORY=1 for the independent graph comparison (add
LAB_FAR_WORKGROUP_TRAJECTORY=1 for the barrier workgroup candidate, or
LAB_FAR_WORKGROUP_LOCAL_TRAJECTORY=1 for the no-barrier candidate). Use LAB_FAR_SCALE=1
for the isolated million-point force study. Record
a unique LAB_ARTIFACT_RUN; raw captures remain in ignored captures/.

## M3 findings · 18 November 2026

Both workgroup candidates remove the global contribution buffer and the
per-level far sums. They declare 512 bytes of workgroup scratch per workgroup.
At one million points this avoids the original design's calculated 800 MB of
contributions **and** 56 MB of far sums; positions, grid data, rendering and
other graph buffers remain. The no-barrier candidate is the more promising
bounded result here. It is opt-in; the graph's existing default and 16,384-point
guard have not changed.

On the frozen 8,192- and 16,384-point uniform and clustered cases, both
workgroup candidates matched every stored force and position bit and passed
all unchanged CPU checks. The chunked control did too. Direct accumulation
passed three cases but failed one force component and two position components
on the 16,384-point clustered case. It produced different force bits even in
its passing cases. These results retain the earlier strict direct-accumulation
failures rather than replacing them with the visual outcome.

The table shows median GPU milliseconds, with the observed seven-sample
range, for the **grid, force and integration step** at 16,384 points. It does
not include rendering or represent full-graph FPS. The direct clustered timing
is diagnostic because that candidate failed the strict CPU gate.

| Far-field method | Uniform GPU ms | Clustered GPU ms | Stored-output bits / CPU checks |
| --- | ---: | ---: | --- |
| Stored / streamed | 12.76 (12.35–15.40) | 13.24 (11.54–18.94) | match / pass |
| Chunked, 4,096 | 14.78 (14.61–18.11) | 15.06 (12.58–18.12) | match / pass |
| Direct accumulation | 10.85 (10.47–11.24) | 12.08 (10.46–13.61) | differ / clustered fails |
| Workgroup with barrier | 11.32 (10.94–17.01) | 13.58 (9.44–15.38) | match / pass |
| Workgroup without barrier | 10.85 (10.58–13.93) | 13.68 (9.42–16.05) | match / pass |

The ranges overlap in several cases, so the small timing differences do not
establish a universal speed ranking. The no-barrier and barrier workgroup
versions matched the stored positions exactly at ticks 1, 10, 50, 100 and 200
for both independently evolving graphs: uniform 8,192 and clustered 16,384,
each with one pinned and one absent point, links, gravity, center, repulsion
and cooling. The selected checkpoints also retained finite present positions,
flags and pinned/absent state. This is not proof of bitwise equality on every
tick or all inputs.

The direct graph's two matched views looked similar on inspection after 200
ticks, but strict position comparison failed at that point for 1,409 coordinate
components in the uniform case and 76 in the clustered case. For the 480 × 340
matched views, the uniform case had 0.050 px RMS and 1.33 px maximum point
separation; clustered had 0.0025 px RMS and 0.14 px maximum. These two still
views do not test flicker, larger graphs or user-perceived quality generally.

### Isolated one-million-point force

A separate test ran the actual direct and both workgroup force shaders for
one million uniform points, with a CPU-prepared hierarchy and eight neighbor
samples, using the balanced shell used at this size. It bypassed the costly GPU
grid builder and the graph guard. All three outputs were finite and repeated
bit-for-bit at the beginning and end of the timed sequence. The two workgroup
outputs matched each other in every force component, and both matched the
independent CPU force reference for 513 sampled targets. Direct also passed
those sampled CPU checks, but differed from the workgroup force in 1,016,800
components across all points. The stored GPU path cannot allocate its old
800 MB buffer on this device, so it was not the million-point comparison.

| Force only, one million points | Median GPU ms | Seven-sample range |
| --- | ---: | ---: |
| Direct | 253.96 | 213.45–260.27 |
| Workgroup with barrier | 285.71 | 250.13–345.32 |
| Workgroup without barrier | 257.80 | 220.33–271.46 |

These ranges overlap and came from one session; the no-barrier timing is
encouraging, not a settled speed ranking. The test held all three output
buffers plus their shared inputs simultaneously, totaling 100.0 MB of measured
application buffers; it omitted graph links, GPU hierarchy construction,
integration, drawing, driver memory and a running layout. Even the isolated
force alone took hundreds of milliseconds, so removing the memory barrier does
not make an interactive million-point graph. The earlier two-mode run observed
293 ms direct and 411 ms with the barrier, illustrating timing variability.

The next work is to optimize the million-point force calculation and replace
or redesign the dense-cell builder, then validate the complete graph. The
separate spatial-index primitive is promising but does not yet implement the
full repulsion hierarchy or sampling.

The WebGPU adapter reported Apple / metal-3 and non-fallback but did not expose
its chip model; same-session WebGL identified Apple M3. The studies used visible
Chrome 157 and luma.gl 10.0.0-alpha.15. Frozen timings, the isolated-million
run and the no-barrier trajectories used the exact source snapshot at
`captures/repulsion-local-m3-20261118/source-snapshot.tar.gz` (SHA-256
`df35bffc18e8e6ddc8ef970f3eb99b724f67aed6b7411573b30bd1521e2daa9b`).
Raw results and images are in `captures/repulsion-local-frozen-m3-20261118/`,
`captures/repulsion-local-million-m3-20261118/`, and
`captures/repulsion-workgroup-local-trajectories-m3-20261118/`. The earlier
direct and barrier trajectories and first million-point run retain their own
snapshots and captures in `captures/repulsion-direct-trajectories-m3-20261118/`,
`captures/repulsion-workgroup-trajectories-m3-20261118/` and
`captures/repulsion-isolated-million-m3-20261118/`.
