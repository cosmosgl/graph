# Persistent dense communities

Can Four corners retain its speed gain and closely follow the per-point
layout when the points stay concentrated? The [earlier clustered
start](#/million-graph?section=doc-cell-field-m3-result) spread out after
the first few ticks. This follow-up keeps eight communities separated
with fixed local anchors. Each free point springs to one nearby anchor.
Local links between anchors connect each community, with at most 66 links
per anchor. For one million points the fixture has 999,990 links, 15,386
pinned points and one absent point.
The communities start on a ring of radius 3,200 world units with anchors
spread over disks of radius 210. Every run starts from the same seed
and cools over 200 ticks.

## Native M3 results

Four corners reduced the median synchronized tick from **55.0–55.6 ms**
to **50.1 ms** on the persistent communities. Both timed orders also
showed lower p95. Every run kept finite positions, unchanged flags and
fixed coordinates, and moved all 984,613 free points.

| Order | Mode | Median tick | p95 tick |
| ---: | --- | ---: | ---: |
| 1 | Per point | 55.0 ms | 75.9 ms |
| 2 | Four corners | 50.1 ms | 63.0 ms |
| 3 | Four corners | 50.1 ms | 66.9 ms |
| 4 | Per point | 55.6 ms | 68.4 ms |

At ticks 50, 100 and 200, every free point stayed within its community
neighborhood in all three layout replays. The p95 count per occupied
finest grid cell ranged from 71 to 79. Four corners passed the
one-pixel visual screen. Of 4,096 sampled IDs, 95% were within **0.581 px**
of the per-point layout at tick 200. Repeating per-point gave **0.569 px**.
At the same tick, the density-grid difference was 0.56% for Four
corners and 0.14% for the repeat. The largest observed excess crossing
motion at p95 in the screened windows was **0.013 px** at the 8×8 level
during ticks 11–50.

### Slow-tick attribution

Median repulsion and integration in the split-pass replays fell from
13.35 to 8.10 ms. Median drawing was about 30 ms in both modes.
Timing p95 in the split-pass replay was **67.0 ms** for per-point and
**70.3 ms** for Four corners. The final position p95 difference between
each replay and its matching ordinary run was 0.56 px for each mode
after rounding.

| Stage or remainder | Per point median | Per point slowest 5% median | Four corners median | Four corners slowest 5% median |
| --- | ---: | ---: | ---: | ---: |
| Repulsion and integration | 13.35 ms | 15.66 ms | 8.10 ms | 8.09 ms |
| Drawing | 30.01 ms | 39.72 ms | 29.82 ms | 31.80 ms |
| Elapsed time outside measured stages | 6.11 ms | 7.65 ms | 6.37 ms | 30.80 ms |

The slowest Four corners ticks in the instrumented run spent much
more time outside the measured stages. The follow-up below times
spatial index construction and the submission and completion boundaries.
The 480 × 340 prototype ends timing at GPU completion. Layout quality,
presentation pacing and pointer response on representative production
graphs still need an integrated-viewer run.

### Spatial index follow-up

The follow-up asks whether rebuilding the spatial index explains the slowest ticks. Use the same seed, canvas, graph and cooling schedule. Run one ordinary per-point lane, one ordinary Four corners lane, then one instrumented Four corners lane and one instrumented per-point lane. Time 200 ticks per lane and set aside the first three as warmups. Compare the completed layouts between each mode's ordinary and instrumented replay to check for changes from profiling.

In the instrumented lanes, measure the clear, count and prefix scan, and scatter passes separately with adjacent timestamps from each pass. Keep the index dispatches, cursor copy and two submissions in their ordinary order. The instrumented lanes still split the later simulation or camera passes as in the earlier profile. Compare the three index pass durations as a sum for each tick. Select the slowest ten ticks independently in each lane using synchronized elapsed time and report their median alongside the full run median. Record the measured CPU time through both submissions and the wall time from the second submission to the completion fence. CPU encoding can overlap GPU execution. The difference between elapsed time and the sum of measured GPU durations still includes the cursor copy, gaps between passes or submissions and the fence or browser wake-up delay.

One replay on the M3 found that the measured spatial index passes grew by **0.17 ms** in the slowest Four corners ticks. Drawing grew by **9.43 ms**, the largest increase of the measured GPU stages.

| Lane | Median tick | p95 tick |
| --- | ---: | ---: |
| Per point, ordinary | 53.6 ms | 70.7 ms |
| Four corners, ordinary | 48.3 ms | 58.2 ms |
| Four corners, instrumented | 48.4 ms | 58.8 ms |
| Per point, instrumented | 52.2 ms | 60.7 ms |

| Instrumented metric, in ms | Per point median | Per point slowest ten median | Four corners median | Four corners slowest ten median |
| --- | ---: | ---: | ---: | ---: |
| Spatial index GPU passes | 0.94 | 0.99 | 0.88 | 1.05 |
| Drawing GPU pass | 28.16 | 34.35 | 28.36 | 37.79 |
| CPU through both submissions | 1.3 | 1.8 | 1.7 | 2.0 |
| Wall after second submission | 50.9 | 60.7 | 46.7 | 60.2 |
| Elapsed time outside measured GPU passes | 4.30 | 6.44 | 4.78 | 8.07 |

The earlier Four corners residual of 30.80 ms in the slowest ten ticks did not recur. Applying the earlier stage list to this replay gives **8.82 ms**, so adding index timestamps accounts for only a small part of the gap here. The cause of the earlier spike remains open. Every lane kept finite positions, exact flags and pins, and moved all free points. Each instrumented replay differed from its matching ordinary run by about 0.56 px at p95 in the final position sample. The expanded timing test and 14 resident and spatial-grid controls passed.

The follow-up used visible Chrome 157 with ANGLE Metal Apple M3 and non-fallback Apple `metal-3` WebGPU. Its raw ticks, per-pass timings, protocol and source are in `captures/dense-grid-20261119-y6qz3h7m/`. The archive SHA-256 is `1f20a30f05c578ce9f961e9049e663655a5b4f4cb02fe93bfcac73d092e85356` with base revision `d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`.

## Comparison plan

- Check finite final positions, exact flags and exact fixed positions
  on each run. In layout replays, check ticks 1, 10, 50, 100 and 200.
  For ticks 50, 100 and 200 the fixture counts as persistently dense
  when at least 95% of free points remain within 40% of the spacing
  between neighboring community centers and the 95th-percentile
  occupancy of nonempty finest cells in the per-point view bounds
  exceeds eight near samples.
- Compare 4,096 free IDs at each checkpoint in the per-point camera
  and count present points in the same 96×96 density grid. Repeat the
  per-point run to estimate its own repeatability. Track the first
  1,024 free IDs each tick and record how much each movement vector
  changes for points whose GPU cell assignment switches. The grid also
  moves, so the population includes switches caused by a shifting grid.
- Use one canvas pixel as a **local visual screen** at 480 × 340. The
  95th-percentile positional drift must be at most one pixel at ticks
  50, 100 and 200. The 95th-percentile change in motion for crossing IDs
  must increase by at most one pixel over per-point at each shared grid
  level during ticks 11–50 and 51–200. Record density differences and
  large individual excursions even when the screen passes. A window
  with no crossing samples is incomplete. A production decision needs
  quality and response budgets on representative interactive graphs.
- In visible native Chrome, measure synchronized 480×340 ticks including
  updates, GPU work and drawing in per-point, Four corners, Four corners,
  per-point order. Save the first three warmups and the 197 measured ticks
  from each run, without numerical readbacks in the measurement window.
- Run one separate timestamp replay per mode with the same workload.
  Collect paired timestamps for gravity and integration, bounds and
  normalization, hierarchy and field construction, repulsion and
  integration, spring updates and camera, and drawing. Compare median
  stage times on all measured ticks and on the slowest 5% in each
  replay. Record the difference between elapsed time and the sum of
  measured GPU stages. That remainder includes spatial index construction,
  submission and fence overhead. Compare replay positions with the
  matching ordinary run to detect effects from splitting GPU passes.

## Reproduce

Set `LAB_ARTIFACT_RUN` to a fresh name, `LAB_SOURCE_REVISION` to the base
revision, and `LAB_SOURCE_SNAPSHOT` to the exact snapshot path. From the
repository root run the native comparison with no other timing or build
work active.

```sh
LAB_NATIVE_VISIBLE=1 LAB_DENSE_COMMUNITIES=1 \
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/resident-dense-communities.test.ts
```

Run the spatial index follow-up with the same source and artifact fields.

```sh
LAB_NATIVE_VISIBLE=1 LAB_DENSE_GRID_PROFILE=1 \
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/resident-dense-communities.test.ts
```

In the live example, choose **Dense communities** under **Starting layout**.
Select 1,000,000 points and run each mode with
the same starting layout to view the behavior on the current device.

The recorded run used visible Chrome 157, luma.gl 10.0.0-alpha.15,
Node 24.6.0 and pnpm 10.15.0. The same session identified Apple M3
through ANGLE Metal on WebGL. WebGPU reported Apple Metal 3 with
`fallback: false`. Raw timing windows, timestamp durations, density counts,
motion samples, the declared protocol and source archive are in
`captures/dense-communities-20261119-2z5y6zzt/`. The archive SHA-256 is
`9cb4684d044c36e5271c351feb288fde0518272fe915a28152e8f6ed022243d7`,
with base revision `d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`.
