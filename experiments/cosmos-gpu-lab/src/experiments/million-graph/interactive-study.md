# Moving graph interaction on M3

Can the GPU-resident million-point graph stay responsive while a person
pans, zooms and picks points? Run the same Lab view with Four corners on the
M3 at 65,536, 262,144 and 1,000,000 points. Each size has persistent dense
communities and a matched high-degree workload. The latter redirects local
links to one unpinned hub while preserving edge counts and initial positions.
The two workloads can evolve differently and their links can cover different
pixels.

The initial sweep met both timing references at 262,144 points and missed
them at one million. The expanded replay repeats the original sizes and adds
393,216, 524,288 and 786,432 points. A later pass at 131,072 and 196,608
samples the region between the repeatable 65,536-point result and the
intermittent miss at 262,144.
Repeat the highest passing intermediate size once with the same protocol
to check whether the result holds in a fresh browser session.

The timing results below compare WebGPU variants using the original pilot
references. Migration performance at one million points requires paired
production WebGL timings. [Performance rule](#/validation-workflow?section=performance-against-production-webgl)

## Native M3 findings

### Requesting the next frame early

Four million-point lanes completed on native Apple Metal 3 WebGPU in visible
Chrome 157 with luma 10.0.0-alpha.15. Both paths used Reduced drawing, with one
tick in flight. Each pick returned the expected ID and visible highlight.

| Workload | Frame p95, after fence → early request | Intervals ≤33 ms | Worst pick |
| --- | ---: | ---: | ---: |
| Dense | 50.1 → 34.2 ms | 18/48 → 11/48 | 44.7 → 44.3 ms |
| Hub | 50.0 → 50.0 ms | 9/48 → 10/48 | 40.3 → 39.8 ms |

The early request missed the frame gate on both graphs. It skipped 48 dense
and 51 hub callbacks during the steady samples while earlier work was still
in flight. Interaction interval p95 was 67.3–83.4 ms across the four lanes.
The first synchronized frame took 305–452 ms from Run, including static data
generation. An in-capacity replacement from 999,990 to 999,989 links took
235–255 ms to reach the next animation opportunity with the update. Peak
sampled luma allocation was 189.5 MiB. The startup and update timings cover
this Lab viewer and its basic styles.

| Workload | Simulation GPU median, after fence → early | Drawing GPU median | GPU total median | Idle after fence, p95 |
| --- | ---: | ---: | ---: | ---: |
| Dense | 12.33 → 12.56 ms | 13.65 → 13.62 ms | 25.86 → 26.18 ms | 9.7 → 6.1 ms |
| Hub | 15.55 → 15.68 ms | 13.60 → 13.43 ms | 29.13 → 29.12 ms | 17.4 → 17.0 ms |

These split-pass diagnostics include the GPU stages and the complete draw.
The hub springs took about 5.92 ms versus 2.42–2.46 ms for dense. Drawing
was the largest single stage. The early request can reduce wake-up gaps but
still leaves more GPU work than fits in a single refresh interval. Keep the
existing scheduling in the demo for now.

Captures are in `captures/resident-pacing-m3-20261120-035249/` and
`captures/resident-pacing-profile-m3-20261120-035334/`. Both refer to the first
directory's exact source archive with SHA-256
`199432406a8c93cabcecb9861f713b52f2f905a78dcfbad59e498847b3ce5408`.
The smaller viewer's [68.2 and 100.4 ms pick stalls](#/pilot-viewer?section=doc-findings)
remain recorded for that workload.

### Depth-tested links

On the same M3, depth tested links matched every pixel in the frozen
comparisons at DPR 1 and 2, at Fit and 3×. The moving run kept exact pick IDs
and all 32 picks met 50 ms. Median profiled drawing went from 13.51 to 12.61 ms
in the dense graph and from 13.45 to 12.47 ms in the hub graph. Peak sampled
GPU allocation went from 189.5 to 191.5 MiB. In the uninstrumented run, just
21 of 48 dense and 11 of 48 hub candidate intervals met 33 ms. Both p95s
remained around 50 ms. The demo keeps its current draw path.

The pixel checks are in `captures/resident-depth-frozen-m3-20261120-035717/`.
The moving and profile runs are in `captures/resident-depth-moving-m3-0-20261120-035817/`
and `captures/resident-depth-moving-m3-1-20261120-035833/`. The source archive
in the first folder has SHA-256
`b540b882478b4b9d8ee852e0f5d2913f23a1ae139c40bd2fd54cfdf190341ccb`.

### Sharing distant pushes at six levels

Adding the 128 × 128 and 256 × 256 fields cut median GPU repulsion from
6.58 to 4.70 ms for dense and 6.49 to 4.70 ms for hubs. Building the
additional fields added under 0.1 ms. Draw remained the largest GPU stage
at about 13–14 ms. Peak sampled allocation increased from 189.5 to 192.0 MiB.

| Workload | Frame p95, four → six levels | Intervals ≤33 ms | Worst pick |
| --- | ---: | ---: | ---: |
| Dense | 50.9 → 50.0 ms | 19/48 → 21/48 | 45.8 → 48.2 ms |
| Hub | 50.0 → 50.0 ms | 8/48 → 14/48 | 40.9 → 42.8 ms |

All 32 picks returned exact IDs and met 50 ms. Both workloads missed the
frame gate. In the separate 200-tick layout replay, the maximum one-tick
sampled displacement between variants projected to 0.32 backing pixels in
both layouts. At tick 200 the sampled p95 drift was 1.85 pixels for dense
and 1.52 for hubs. The density histograms differed by under 0.2%.
Both variants kept valid positions, fixed points and presence flags.
The projection uses the Fit scale and the target canvas height. It describes
world positions at checkpoints. Moving visibility at higher zoom remains open.
The demo keeps four shared levels.

The layout capture and exact source are in
`captures/resident-deep-field-m3-20261120-050554/`, with SHA-256
`bf9a8153535e3dee0a79ff529af8a7be4540106de8f9c71b107d22c70ca9e069`.
The same run name with suffix `-timing-0` contains the visible-browser frame
and click lanes. The `-timing-1` run contains the split GPU timings. All used
native Apple Metal 3, visible Chrome 157 and luma 10.0.0-alpha.15.

### Reduced drawing replay

The matched one-million-point replay compared Standard and Reduced drawing
on the full 961 × 541 CSS canvas at DPR 2. Both used Four corners, the
fixed camera at startup, and the same trusted pan, wheel and click sequence.

| Workload | Median frame interval | Picks within 50 ms | Slowest pick |
| --- | ---: | ---: | ---: |
| Dense | 50.0 → 33.3 ms | 1/8 → 8/8 | 62.9 → 44.5 ms |
| Hub | 50.0 → 33.3 ms | 0/8 → 8/8 | 80.5 → 43.4 ms |

All picked IDs matched the expected results. Each candidate pick used the
cached scene to paint its highlight. Only 18/48 dense and 10/48 hub steady
intervals met 33 ms, with p95 near 50 ms. Peak sampled luma allocation rose
from 154.3 to 189.5 MiB. This is one session with opaque points and basic links.
The results and exact source are in `captures/resident-coverage-m3-cf134e46/`.
Set `VITE_LAB_RESIDENT_RENDER_CANDIDATES=1` on the reproduction command to
repeat these four lanes. [Drawing and pixel checks](#/million-graph?section=doc-draw-cost)

### Standard drawing sweep

**Both workloads met the steady-frame and pick targets at 196,608 points
in two sessions.** Across those four lanes, 191 of 192 steady intervals
met 33 ms and all 32 clicks met 50 ms. The heaviest pick took 45.6 ms.
Layout updates slowed during the click sequence, with interval p95 of
50.9–66.7 ms. At 262,144 points both graphs met the steady-frame target
in both runs. One dense pick in the expanded session took 52.4 ms.

**One million points stayed usable for controlled pan, zoom and exact
selection.** Both expanded lanes had about 50 ms steady median intervals
and zero intervals within 33 ms. Peak sampled luma allocation was
154.3 MiB. All 16 clicks had the expected result, including background.
Only two finished within 50 ms. In the high-degree lane the slowest
pick took 76.9 ms. The typical ID readback was about 1–1.4 ms. Queueing
and full-scene redraw of the highlight accounted for most of the wait.

| Points | Workload | Steady frame p95 | Intervals ≤33 ms | Slowest pick | Picks ≤50 ms | Peak tracked |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 65,536 | Dense | 17.5 ms | 48/48 | 30.0 ms | 8/8 | 47.3 MiB |
| 65,536 | Hub | 17.4 ms | 48/48 | 38.6 ms | 8/8 | 47.3 MiB |
| 131,072 | Dense | 16.9 ms | 48/48 | 39.6 ms | 8/8 | 54.8 MiB |
| 131,072 | Hub | 17.7 ms | 47/48 | 39.3 ms | 8/8 | 54.8 MiB |
| 196,608 | Dense | 17.3 ms | 47/48 | 39.3 ms | 8/8 | 62.3 MiB |
| 196,608 | Hub | 17.1 ms | 48/48 | 45.6 ms | 8/8 | 62.3 MiB |
| 262,144 | Dense | 17.5 ms | 48/48 | 52.4 ms | 7/8 | 69.8 MiB |
| 262,144 | Hub | 16.7 ms | 47/48 | 38.4 ms | 8/8 | 69.8 MiB |
| 393,216 | Dense | 32.8 ms | 46/48 | 51.7 ms | 7/8 | 84.8 MiB |
| 393,216 | Hub | 50.0 ms | 34/48 | 38.2 ms | 8/8 | 84.8 MiB |
| 524,288 | Dense | 50.0 ms | 33/48 | 53.1 ms | 7/8 | 99.8 MiB |
| 524,288 | Hub | 50.0 ms | 24/48 | 56.6 ms | 7/8 | 99.8 MiB |
| 786,432 | Dense | 50.0 ms | 9/48 | 57.2 ms | 1/8 | 129.9 MiB |
| 786,432 | Hub | 50.7 ms | 0/48 | 43.8 ms | 8/8 | 129.9 MiB |
| 1,000,000 | Dense | 50.6 ms | 0/48 | 63.8 ms | 2/8 | 154.3 MiB |
| 1,000,000 | Hub | 50.9 ms | 0/48 | 76.9 ms | 0/8 | 154.3 MiB |

The table combines the expanded sweep and the two intermediate sizes.
The 196,608-point repeat recorded p95 of 17.0 ms dense and 17.5 ms hub.
All 96 steady intervals and 16 clicks met their targets in that repeat.
At one million points in the initial sweep, steady p95 was 51 ms in both
lanes and the slowest picks took 69.8 ms dense and 77.2 ms hub.

All 24 completed lanes passed camera, exact ID, highlight and movement
checks. The hub fixture has 8,120 source-grouped spring edges at 65,536
and 8,192 at larger sizes. Timing differences describe whole workloads.
The graph, camera and click sequence can all affect frame and pick cost.
The samples establish a local tested range on this machine. Wider graphs
and production rendering remain outside it.

### Environment and evidence

The recorded runs used automatic framing on each tick before the first pan.
The live demo now fits once at startup and on each press of Fit.

Visible Chrome 157 on the user's Apple M3 reported Apple `metal-3` WebGPU
with `fallback: false` and luma 10.0.0-alpha.15. The full canvas was visible
at 961 × 541 CSS px inside a 1,280 × 900 viewport at DPR 2. Each lane records
the actual adapter, timing phases, viewport and sampled allocation counts.
The base revision for all captures was
`9e1ef65d46425ef4e97f81db7a74370f58bf1ba5`.

| Run | Local capture under `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Initial six lanes | `resident-interaction-20261119-111943-aef1d214/` | `3451dc371e0a87ddcea41ac85e4a63bd5854bc2c8d0cfafcb266d72c08d49a60` |
| Expanded twelve lanes and draw replay | `resident-expanded-20261119-112145-e06e8eea/` | `3ce113757bded07fa40a21b0adaf804e4cf69ec343b87c9992bf74a4a1a593f6` |
| Four intermediate lanes | `resident-bracket-20261119-112329-b7ba35a0/` | `4ba5a2f3f61a39c0a00dd3e87d21b1eadbd2fea53fe5312c0379ea361148df37` |
| Two 196,608-point repeats | `resident-repeat-20261119-112436-e8f6bb3a/` | `5c49d8505235032c4a74b0ade7f74f1b5ec1e49add39c045bacdb2505266eb26` |

The first attempt stopped before running tests when the Vitest UI forced a
null Playwright viewport with device scale factor 2. Its log and snapshot
remain in `captures/resident-interaction-20261119-111841-9634fc62/`. The
measured runs use the declared visible viewport with the Vitest UI closed.

## Declared comparison

- Use visible standalone Chrome, native WebGPU, 961 × 541 CSS pixels and a
  1,922 × 1,082 attachment at DPR 2. Require the full canvas visible at native
  scale. Record the browser, adapter, source, actual viewport and allocation
  samples. Use the same seeded inputs and 200-tick cooling schedule.
- Run 8 warmup ticks. Record 48 consecutive moving frame intervals from the
  next 49 animation callbacks. Record GPU-fenced tick completion separately.
  Then send actual browser pointer drags, a wheel zoom and eight alternating
  point and background clicks while simulation is active. Check camera
  movement, cursor-centered zoom and movement after every click. Retain the
  consecutive frame intervals during that interaction sequence separately.
- Use an isolated pin at the origin (ID 0). The absent ID 1 occupies the
  same position. The picker scans the current resident positions on the GPU.
  It resolves overlap by paint order and copies back a four-byte ID. Require
  all expected IDs and background results, trusted input and a visible
  highlight color on the last selected point. Verify finite final positions,
  unchanged flags and fixed coordinates, and movement of free points.
- Measure pointer-up handler to highlight GPU completion and the following
  animation opportunity. Keep queueing, ID readback, highlight draw and
  animation wait separate. Frame intervals measure graph update pacing in
  the browser. Physical presentation time is outside this probe. There are
  no full position or pixel reads in the frame or click timing windows.
- Report the largest sampled luma buffer and texture allocations above the
  baseline at setup and after submissions. These samples cover tracked
  resources. CPU allocations, driver memory and unobserved transient peaks
  are outside this measurement.

The recorded checks use 95% of moving frame intervals within 33 ms and
feedback within 50 ms as references from the small pilot. Keep missed timings
and incomplete lanes visible. A running fixture and exact picks establish bounded behavior.
Production appearance, remaining forces, arbitrary pointer targets and other
devices require separate checks.

### Browser frame scheduling

Compare both million-point fixtures with Four corners and Reduced drawing.
Keep a single simulation tick in flight in both lanes. The control requests
the next animation callback after the GPU fence. The candidate requests it
before submitting the current tick and skips callbacks while a tick or pick
is still in flight. Measure intervals between callbacks that submit and
complete graph updates. Record every skipped callback, submission time,
GPU-fence wait and time from completion to the next update callback.

Use the same eight warmup ticks, 48 steady intervals and native input
sequence. Time a same-point-count link replacement while the viewer is
moving, from the topology call through the frame with the new links and the
next animation opportunity. Report it separately from steady and pick timing.
Keep both fixtures and both sequencing variants visible in the result.

Repeat with split simulation passes instrumented using GPU timestamps. The
timestamp lanes diagnose simulation and draw work, including point filtering
and highlight composition. Use the ordinary pass layout for the frame gate.
Read timestamps and positions after timing. Keep browser callback latency
distinct from either sum of GPU timings or fence latency.

### Opaque link overdraw

Use the original fence scheduling for this comparison. Compare Reduced drawing
with the same draw using a depth attachment. Draw opaque points in their
original order, then draw the single-color opaque links farther away. Reject
link fragments where a point or an identical-color link already wrote a sample.
Check exact output pixels against the original draw before testing moving frame
and pick times on both million-point fixtures. Measure draw GPU time and added
allocation. This probe uses basic opaque links and preserves point occlusion.

### Four corners at more grid levels

Test sharing the distant pushes at 128 × 128 and 256 × 256 too. The control
shares from 8 × 8 through 64 × 64. Both keep the 512 × 512 level and nearby
sampled forces per point. Measure the same moving interactions and split GPU
stages, and track the extra field storage. Check motion on both graphs at
ticks 1 and 200 against the four-level control. Use the one-backing-pixel
one-tick screen and inspect the settled drift separately.

## Replay

Set a unique lowercase `LAB_ARTIFACT_RUN`, `LAB_SOURCE_REVISION` and
`LAB_SOURCE_SNAPSHOT`. Run without competing builds or tests.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_RESIDENT_INTERACTION=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/million-graph/resident-interaction.test.ts
```

Set `VITE_LAB_RESIDENT_FRAME_PACING=1` to compare callback scheduling. Add
`VITE_LAB_RESIDENT_FRAME_PROFILE=1` in a fresh capture for GPU timestamps.
Set `VITE_LAB_RESIDENT_DEPTH_LINKS=1` instead of the pacing flag to compare
the depth-tested draw path. The same flag selects the frozen depth comparison
with `VITE_LAB_RESIDENT_DRAW_COST=1` in `resident-draw-cost.test.ts`.
Use `VITE_LAB_RESIDENT_DEEP_FIELD=1` for the additional grid levels. Use the
same flag with `resident-dense-communities.test.ts` for the layout comparison.
