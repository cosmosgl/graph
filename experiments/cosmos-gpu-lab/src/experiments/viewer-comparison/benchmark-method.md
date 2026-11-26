Compare the built WebGL Graph and the Lab WebGPU prototype on
the same workload in separate, visible Chrome sessions on the Apple M3. The
runner compares the GPU-finished frames available at animation opportunities,
the feedback that reaches the page, and the allocations each backend tracks.
[Recorded results](#/viewer-comparison?section=doc-migration-results) · [Performance example audit](#/viewer-comparison?section=doc-performance-audit)

The WebGPU side uses the Lab's solver, renderer and frame loop. The
[packaged force benchmark](#/production-forces?section=doc-scale-timing)
loads both built Graph packages.

## Run the comparison

Build the workspace control, then run these commands one at a time with the
browser window visible. The runner starts and closes its local server and
browser. Prepare the real fixture using the [YouTube instructions](#/million-graph?section=doc-production-envelope)
before the last run.

```sh
pnpm run build
pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture karate
pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture dense
pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture hubs
pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture youtube
```

Use `--smoke` to check the harness with fewer samples and no timing verdict.
Use `--steady-only` to repeat an inconclusive steady-motion result under the
same startup, camera, timing window and margin. That run reports only steady
frame p95. Retain the original full workflow and its verdicts alongside it.
For a capacity failure, repeat with `--points` on the affected large fixture
and record the largest completed size tested. A smaller YouTube run uses the
induced subgraph of the same ordered IDs. Keep each attempt in its own capture.
The runner saves exact source, bundle checksum, Chrome and adapter details,
fixture fingerprint, raw intervals, failure stage and calibration. It saves
an initial and a moving checkpoint image outside the timed windows.

## Workload

Use a 961 × 541 CSS canvas at DPR 2. Start both backends from the same seeded
positions, topology, weights, absence and pins. WebGPU receives the actual
Float32 positions supplied to WebGL, translated from the production origin to
zero. Use 5,000-tick cooling, gravity 0.25, repulsion 1, friction 0.85,
spring strength 1, rest length 10 and variation 1–1.2. Global centering and
collision are off in production's defaults. Both use exact all-pairs repulsion
for Karate. At one million points, WebGL uses its automatic solver and
eight near-field slots from its work budget. The candidate uses eight near
slots and Four corners. The solver random streams and far-field approximation
can differ. Check layout quality at the recorded checkpoints before using a
timing result to support migration.

Use filled, opaque circles and smooth solid links with the default colors,
one-CSS-pixel width and distance-dependent opacity. Points are four CSS pixels,
or two in the declared YouTube fixture. Fit around the same initial origin
with a fixed zoom for each input. Keep the camera stable during steady motion.
The candidate uses Viewer Comparison's corrected renderer with the scalable
WebGPU solver. The default depth optimization is enabled in WebGL. The
candidate renders the points with its existing blended circle path.

- **Startup** From preloaded input to the first GPU-finished canvas frame at
  an animation opportunity. Repeat after destroying the graph in the same
  Chrome process for the warm row. The bundled code and fixture are preloaded.
- **Motion** Start each backend's normal loop. After eight observed frames,
  measure 48 frame intervals. The WebGL probe observes luma fences after
  the production draw. WebGPU uses the completion already awaited in its
  resident viewer loop. The observer counts one completed canvas image per
  browser animation opportunity and coalesces earlier completed frames.
  Record missed opportunities and submitted frames that coalesced. The
  benchmark observes a browser presentation opportunity as a display proxy.
- **Input** From the same native pan and wheel sequence, click known point
  centers and background. The two community fixtures use their existing
  isolated pin. For Karate and YouTube, park three existing points at the same
  known screen positions after measuring steady motion. The rest of the graph
  keeps moving. Move the pointer and dwell for two observed frames on both
  backends. Start every latency sample at the trusted `click` timestamp.
  WebGL uses its normal hover result. WebGPU uses its point-ID read at click.
  Both show the same marker and point ID in the page, or clear the marker on a
  miss. Time through the next animation opportunity. Record all 12 results,
  first click, p95 and maximum. A mismatched target leaves pick speed unassessed.
- **Selection and labels** On the same moving graph, alternate the rectangle
  and polygon four times each. The page displays the selected count and area.
  At each request collect positions for the same 1,000 tracked indices, or all
  34 for Karate, through the same `CosmosLabels` consumer. Measure each result
  through the next animation opportunity. Check label identities, motion,
  and pending selection invalidation when replacing graph data. Retain null or
  empty selections and missing labels as incomplete results, then continue the
  remaining measurements while the graph can still run.
- **Updates and memory** Time a sparse position edit, topology replacement,
  full same-size replacement and resize to the next completed frame. Sample
  app-owned GPU buffers and textures reported by each luma version during
  setup, frames, readback and replacement. Transient allocations between
  samples, allocator overhead, browser and driver memory are outside this metric.

## Timing decision

Declare margins before WebGPU runs. Start with two fresh WebGL controls.
For each metric use the larger of the A/A spread and a quarter of the measured
idle refresh interval. The minimum for memory is 1 MiB. Clamp that minimum to
the following user-impact limits. A/A spread beyond the limit is inconclusive.

| Metric | Largest allowable slowdown for this study |
| --- | --- |
| Frame p95 | Three quarters of one refresh interval, so a whole extra refresh does not pass |
| Picks, area and label feedback, resize and sparse changes | One refresh interval of added feedback delay |
| Startup, topology and full replacement | 10% of the WebGL control time |
| Tracked peak GPU memory | 10% of the WebGL control allocation |

These are working margins for the M3 study. Repeat the two paired runs in
fresh sessions and reverse backend order. Report both measured values and
their change in milliseconds and percent, or MiB and percent for memory.
A verdict requires complete paired runs, valid motion and stable controls.
Both pairs must agree. If WebGL cannot complete the workload, record the
failure and give the numeric results available with **Not assessed** for
relative speed. Click precision, recurring stalls and independently evolved
visual quality still matter alongside each timing verdict.

The [historical comparison](#/viewer-comparison?section=doc-method) keeps the
original 33 ms frame and 50 ms feedback checks for that replay.
