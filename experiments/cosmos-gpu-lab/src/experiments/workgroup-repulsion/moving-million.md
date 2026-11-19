# A moving million-point graph

## Question

Can the GPU rebuild the full repulsion hierarchy and selected neighbor samples
on each tick, while a million-point graph moves and draws on the M3?

## Method

This is a new lab-only candidate. For each tick it calculates gravity, builds
the finest-cell index on the GPU, derives the coarser cells from their four
children, selects eight near-neighbor samples per fine cell, calculates native
repulsion, applies link springs, integrates positions and draws points and
links. Bounds, cell membership, samples, forces and changing positions remain
on the GPU during the tick. The GPU execution order groups nearby targets.

Check the hierarchy against the existing scalar reference and the force against
the scalar force calculated from the GPU-produced hierarchy on small fixtures,
including empty cells, partial workgroups, pinned and absent points, and dense
cells. Compare a short moving graph against the existing bounded WebGPU graph;
record positional differences and do not treat a completed run as numerical
acceptance. The new accumulation order and the earlier native arithmetic can
change rounding. Retain failures and validate point movement, finite present
positions, flags, and pinned/absent invariants after the large run.

For the large experiment use one million deterministic, uniformly distributed
points and a chain of 999,999 links. Run a short warmup followed by measured,
independently evolving ticks with cooling. Recalculate camera bounds on the GPU
after each tick so the moving points remain in view. Use a visible 480 × 340 Chrome canvas
on the M3, with luma.gl and the non-fallback WebGPU adapter recorded. Record
each tick's CPU submission-to-GPU-completion elapsed time, including drawing;
wait for completion once per measured tick so this is a synchronized benchmark,
not a promise of presentation frame rate. Position readbacks and screenshots
are outside the timed intervals. Retain a source snapshot, raw samples,
failures, adapter details and relevant settings in a unique capture directory.
Repeat the short measurement, then run a separate 200-tick cooling lifecycle
with the same fixture and record all synchronized frame times and final checks.

The CPU prepares the initial point data and static link topology once. It does
not rebuild the spatial hierarchy or read back point positions during measured
ticks. The candidate uses eight samples and native repulsion arithmetic; it is
not the production WebGL implementation, does not cover all graph features or
other devices, and does not remove the existing full-viewer size guard.

## Findings

The lab-only WebGPU graph ran **one million points and 999,999 links** for 200
cooling ticks on the M3. The GPU rebuilt the full repulsion hierarchy each tick;
positions stayed on the GPU until the final check. All present points were
finite, the pinned and absent points retained their positions and flags, and
999,998 points moved. This is a synthetic chain, not the full Cosmos viewer.

| Run | Synchronized frame median | Range | Scope |
| --- | ---: | ---: | --- |
| 10 ticks | 36.0 ms | 33.5–38.5 ms | Seven measured frames after three warmups |
| 10 ticks, repeat | 37.3 ms | 34.9–38.9 ms | Seven measured frames after three warmups |
| 200 ticks | 44.7 ms | 35.1–66.4 ms | 197 measured frames after three warmups; 95th percentile 57.4 ms |

Times include CPU submission, GPU completion, gravity, hierarchy and repulsion,
both link-spring passes, integration, GPU camera fit, and drawing a 480 × 340
frame. Each frame waits for GPU completion; presentation, pointer handling and
browser compositing are not measured. The figures are not a claim of stable
interactive frame rate. One million five-pixel points cover each other at this
view size, so the screenshot is not a sufficient visual-quality assessment.

On one frozen uniform million-point input, the GPU hierarchy had no cell-count,
membership, duplicate-index, missing-index or selected-neighbor mismatches
against the CPU reference. Its aggregate comparison passed the existing mixed
tolerance, and 513 sampled forces passed the existing CPU force tolerance. The
same input rebuilt twice selected identical neighbors but produced different
floating-point bits in 317,701 force components; 91 components failed the
strict force tolerance between those two GPU builds. Their total relative L2
difference was 0.00000266%. Atomic index construction can change the order of
cell summation; long-term visual and interaction consequences are not established.

The hierarchy, index, neighbor slots, normalized positions and centroid buffers
in this prototype accounted for approximately 43.1 MB, and the static link
buffers for 52.0 MB. These are component allocations, not the total graph or GPU
memory usage. The original graph's size guard and production settings have not
changed; this candidate uses native arithmetic, eight samples, simplified point
and line drawing, and no center, collision, picking, dragging or other viewer
features. Other graph shapes, densities and devices remain untested.

The run used visible Chrome 157, luma.gl 10.0.0-alpha.15, Node 24.6.0 and pnpm
10.15.0. The WebGPU adapter reported non-fallback Apple Metal 3; a same-session
WebGL renderer identified Apple M3. The raw captures are in the lab's ignored
`captures/` directory:

- `resident-million-moving-m3-v3-20261118/`: first 10-tick run and screenshot,
  using `resident-million-m3-v3-20261118/source-snapshot.tar.gz` (SHA-256
  `b06af89b6b83e5c4cb046df87ad6f8b7fa747ef8db0ea8a57d77aac374925ff5`).
- `resident-million-moving-m3-repeat-v4-20261118/`,
  `resident-million-moving-m3-200ticks-v4-20261118/` and
  `resident-hierarchy-scale-m3-v4-20261118/`: repeat, lifecycle and hierarchy
  checks, using `resident-million-m3-v4-20261118/source-snapshot.tar.gz`
  (SHA-256 `b85c27a7a94f231299b839af053ae9080a67d7c94fe2691b3dbacde3c3da97a0`).
- `resident-moving-medium-m3-20261118/`: an early attempt stopped before
  simulation because its WebGL identification canvas was missing. The
  subsequent `resident-moving-medium-m3-v2-20261118/` completed with a fixed
  camera and is not used for the auto-fit timing claims above.

Next, test dense and uneven graphs, compare longer independent layouts and
interaction quality, investigate strict replay differences, and integrate the
scalable hierarchy into the existing viewer before judging migration readiness.
