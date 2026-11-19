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

## Native M3 findings

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

Use 95% of moving frame intervals within 33 ms and feedback within 50 ms
as reference points from the small pilot. Keep missed timings and incomplete
lanes visible. A running fixture and exact picks establish bounded behavior.
Production appearance, remaining forces, arbitrary pointer targets and other
devices require separate checks.

## Replay

Set a unique lowercase `LAB_ARTIFACT_RUN`, `LAB_SOURCE_REVISION` and
`LAB_SOURCE_SNAPSHOT`. Run without competing builds or tests.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_RESIDENT_INTERACTION=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/million-graph/resident-interaction.test.ts
```
