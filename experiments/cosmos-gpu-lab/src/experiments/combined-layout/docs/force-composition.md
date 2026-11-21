# Mouse repulsion, clusters and attractors in one tick

The GPU runs each force against the positions from the previous integration
pass. An active mouse stage comes first, followed by gravity, center,
repulsion, incoming and outgoing springs, cluster attraction, per-point
attractors and any configured collision passes. Mouse repulsion can also run
alone during a pause. The pointer coordinates are supplied in world space.

## M3 results

On visible Chrome 157, the WebGPU adapter reported Apple Metal 3 with
`fallback: false` and luma 10.0.0-alpha.15. Paused mouse repulsion and exact
release passed on both graphs. All 24 evolving ticks preserved pins, absence,
flags and finite positions.

| Workload | Position checkpoints within tolerance | Final-force checkpoints within tolerance | First failing zero-based tick |
| --- | ---: | ---: | --- |
| 256 points, two collision passes | 16/16 | 15/16 | 13, two force components |
| 8,192 points, hierarchical repulsion | 1/8 | 4/8 | 1, one position component |

The 8,192-point maximum position error was 0.00615 world units. A per-stage
replay at each first failed tick compared every stage on its actual GPU input.
All same-input checks passed. The staged and normal GPU positions matched
exactly. The largest same-input mouse position difference on the 8,192-point
replay was 0.00000381 world units. The independent trajectories still miss
the strict gate. The first failed tick alone does not identify the source of
the accumulated drift or establish visible layout quality.

### Local layout and motion screen

Both fixtures passed the separate one-pixel screen over all 40 cooling
ticks on the same visible native M3 browser. All 80 ticks preserved pins,
absence, flags and finite positions.

| Points | Maximum projected position difference | Maximum projected motion difference | Strict position / final-force checks |
| ---: | ---: | ---: | ---: |
| 256 with two collision passes | 0.00028 px | 0.00018 px | 20/40 · 38/40 |
| 8,192 with hierarchical repulsion | 0.01413 px | 0.01409 px | 1/40 · 23/40 |

The 8,192-point maximum p95 position difference was 0.000185 px.
These checks use a fitted 480 × 340 camera. Deeper zoom, longer schedules,
other data and pixel output remain unmeasured. The trajectory tolerance
verdicts remain as recorded.

The screen capture is in `captures/composed-layout-motion-m3-20261119-zMu2wT4b/`.
Source SHA-256
`976f95786a101aff3cd24da7714ced3bac9ab8e2c57d2d1b8e3978520b66ffbe`.

### Frozen tick cost

The corrected frozen comparison passed all 28 measured position checks per
lane. Median GPU time was **7.83 ms** for the resident core and **8.33 ms**
with the additional forces. Median synchronized batch completion per tick was
8.80 ms and 9.53 ms. Both lanes included drawing. This controls the starting
layout and bounds the added cost on this graph.

The initial timed replay restored positions within each batch but carried the
previous batch's output into the next. It failed the initial-position check.
The reported timing restores the intended initial positions before every batch
and repeats the original validation. All three attempts remain in the ignored
capture directories:

- `composed-forces-m3-20261119-n5c3rrqj/` contains the original source.
  Its timing arm stopped before measuring because the artifact flag was
  unavailable in the browser. Source SHA-256
  `def62a2df01712574f2751c2aa4ec4bd1b1bd3ab4f1bf7ea7cc533e99fade6b6`.
- `composed-forces-replay-m3-20261119-kltyf6xq/` contains the independent
  checks, same-input diagnostics and invalid timing control. Source SHA-256
  `05686ef7cea4310e8a0fc17845ec7688cd5f0d7a69feed72a9fba20df52421b4`.
- `composed-frozen-cost-m3-20261119-gzh10vs2/` contains the corrected
  frozen timings. Source SHA-256
  `1d452f45bbb1f185d85dfe4ea8b6efc1cb3586965b7981fc8e7c3f3716e62525`.

All archives use base revision `d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`
and retain the measured worktree and lockfile. The full opt-in command reports
the retained strict trajectory failures. Use `-t 'compares the resident GPU cost'`
to select the corrected frozen timing.

## Declared comparison

Use two deterministic communities graphs with seed 29471 and the existing
corrected core. Run 16 ticks at 256 points with two exact collision passes,
and eight ticks at 8,192 points with hierarchical repulsion. The fixture has
one pinned point and one finite absent point. Clusters mix live centers and
explicit targets. Per-point targets include the existing missing and signed
strength cases. Start with the mouse held for two ticks, release it and
disable all targets at tick 2, then install replacement targets at tick 4.
Update cluster membership at tick 6. Apply the production mouse cooling floor
while the pointer is held.

Compare independently evolving GPU positions and last-stage forces with the
scalar references at the existing force and position tolerances. Pins, absence
and flags must stay exact. Exercise the mouse stage alone while paused and
check that releasing it leaves positions unchanged. The bounded fixtures
reuse production force order and kernels tested in the isolated studies.

For the separate visual screen, replay the same two fixtures for a full
40-tick cooling schedule. At each tick project both layouts into a shared
480 × 340 view fitted to the CPU reference. Require every present point to
stay within one canvas pixel of its corresponding CPU position and its
per-tick motion vector to differ by at most one pixel using the same view
scale. Pins and absence retain their exact checks. Record the strict
trajectory results independently. This screen measures geometry and motion
before rasterization. It leaves overlap, paint and pointer usability open.

On the 8,192-point fixture, compare frozen ticks of the resident core and
of the same core with the three additional forces active. Use 480 × 340
canvases in visible Chrome. Alternate lane order over two warmup and seven
measured pairs of four ticks. Restore original positions each tick. Sum
per-pass GPU timestamp pairs for compute and basic drawing, and retain
synchronized completion separately. Validate every captured frame after its
batch. Pointer latency and browser presentation require a viewer workload.

Set a unique `LAB_ARTIFACT_RUN`, `LAB_SOURCE_REVISION` and
`LAB_SOURCE_SNAPSHOT`, then run the native experiment.

```sh
LAB_NATIVE_VISIBLE=1 LAB_COMPOSED_FORCE_TIMING=1 \
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/force-composition.test.ts
```

Use `-t 'screens local layout motion'` to select the two visual screen replays.
