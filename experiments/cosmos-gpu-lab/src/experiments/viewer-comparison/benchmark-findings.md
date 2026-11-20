Karate Club took about 18 ms per frame on both backends. At one million
points, WebGPU cut frame p95 by about 55% on both community fixtures. Both
WebGL controls moved the full YouTube graph and stopped at the first moving rectangle selection. WebGPU
completed that workflow. Its million-point YouTube speed verdict is **Not assessed**.

## What ran

On 20 November 2026, visible Chrome `157.0.8103.79` ran one backend at a time
on Apple M3. The production ANGLE Metal adapter identified Apple M3 and used
luma `9.3.6`. WebGPU reported non-fallback Apple Metal 3 and used luma
`10.0.0-alpha.15`. Both used 961 × 541 CSS pixels at DPR 2. The initial
positions, topology, flags, circle and link styles, camera, force settings,
cooling and pointer sequence were matched. The [method](#/viewer-comparison?section=doc-migration-benchmark)
names the solver and scheduling differences and the working margins.

Each full comparison reports the mean of its two paired runs' measurements.
Positive changes mean more time or tracked allocation on WebGPU. Each paired
run had 48 steady intervals, 12 clicks, four rectangles and four polygons
alongside the moving label renderer. At 12 clicks, the nearest-rank p95 and
maximum are the same. Earlier pilot 33 ms and 50 ms scores remain in the
[original report](#/viewer-comparison?section=doc-findings).

## Karate Club · 34 points, 78 edges

Both paired runs returned every requested ID and background result on each
backend. The initial images show the same circle and link layout. The moving
checkpoints show compact graphs with different orientations. Steady time and
click latency stayed within the working margins. The candidate's measured
peak was 7.8 MiB higher, including its selection and label allocations. Cold
WebGL startup varied beyond the declared limit.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms) | 18.0 | 18.1 | +0.2 | +0.8 | 4.2 | Within margin |
| Interaction frame p95 (ms) | 33.7 | 17.8 | -15.9 | -47.0 | 4.2 | Within margin |
| First click (ms) | 16.3 | 13.8 | -2.5 | -15.3 | 4.2 | Within margin |
| Click p95 (ms) | 16.6 | 16.9 | +0.3 | +2.1 | 4.2 | Within margin |
| Slowest click (ms) | 16.6 | 16.9 | +0.3 | +2.1 | 4.2 | Within margin |
| Cold startup (ms) | 133.0 | 64.7 | -68.3 | -51.4 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Warm startup (ms) | 97.5 | 66.5 | -31.0 | -31.8 | 4.2 | Within margin |
| Point update (ms) | 31.7 | 14.2 | -17.5 | -55.2 | 4.2 | Within margin |
| Topology update (ms) | 33.8 | 16.6 | -17.2 | -51.0 | 3.3 | Within margin |
| Full replacement (ms) | 33.3 | 16.6 | -16.7 | -50.2 | 3.4 | Within margin |
| Resize (ms) | 34.8 | 15.7 | -19.0 | -54.8 | 4.2 | Within margin |
| Rectangle p95 (ms) | 21.3 | 16.9 | -4.4 | -20.7 | 8.6 | Within margin |
| Polygon p95 (ms) | 16.9 | 17.1 | +0.3 | +1.5 | 4.2 | Within margin |
| Moving labels p95 (ms) | 21.3 | 17.1 | -4.2 | -19.5 | 6.8 | Within margin |
| Peak tracked memory (MiB) | 2.2 | 9.9 | +7.8 | +356.4 | 0.2 | Over margin |

## Dense communities · 1,000,000 points, 999,990 edges

[Open the live Dense Communities demo](#/dense-communities).

Both backends kept the eight communities visible, moved all 984,613 free
points and preserved pinned and absent state. Each paired WebGL window missed
367–368 estimated animation opportunities against 100–102 for WebGPU.
All requested IDs and backgrounds resolved correctly. Both moving viewers
produced 1,000 label positions per request. Label and rectangle p95s were
within the margin, with substantially lower measured WebGPU times. Some
other workflow controls were too variable for a verdict.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms) | 151.4 | 67.0 | -84.3 | -55.7 | 4.2 | Within margin |
| Interaction frame p95 (ms) | 392.4 | 52.0 | -340.4 | -86.7 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| First click (ms) | 457.6 | 49.3 | -408.3 | -89.2 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Click p95 (ms) | 521.1 | 59.8 | -461.4 | -88.5 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Slowest click (ms) | 521.1 | 59.8 | -461.4 | -88.5 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Cold startup (ms) | 626.6 | 357.3 | -269.3 | -43.0 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Warm startup (ms) | 607.5 | 347.2 | -260.3 | -42.9 | 16.7 | Within margin |
| Point update (ms) | 888.8 | 49.3 | -839.4 | -94.4 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Topology update (ms) | 1233.4 | 248.9 | -984.5 | -79.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Full replacement (ms) | 1173.5 | 225.5 | -948.0 | -80.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Resize (ms) | 838.7 | 58.6 | -780.1 | -93.0 | 5.2 | Within margin |
| Rectangle p95 (ms) | 1342.3 | 56.3 | -1286.0 | -95.8 | 4.3 | Within margin |
| Polygon p95 (ms) | 1181.8 | 16.9 | -1164.9 | -98.6 | 8.6 | Not assessed · Paired WebGL runs drifted beyond the control limit |
| Moving labels p95 (ms) | 1490.5 | 56.3 | -1434.2 | -96.2 | 4.2 | Within margin |
| Peak tracked memory (MiB) | 543.0 | 200.1 | -343.0 | -63.2 | 1.0 | Within margin |

## Hub communities · 1,000,000 points, 999,990 edges

[Open the live Hub Communities demo](#/hub-communities).

The hub with 8,192 source-grouped links stayed visible on both renderers,
alongside the eight communities. All paired picks matched their expected
point or background. Both backends produced 1,000 moving label positions per
request. Full-workflow WebGL controls were 166.8 and 151.5 ms frame p95,
with a spread beyond the working limit. The first table retains that verdict.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms) | 151.6 | 68.6 | -83.0 | -54.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Interaction frame p95 (ms) | 366.0 | 68.3 | -297.7 | -81.3 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| First click (ms) | 369.8 | 63.5 | -306.3 | -82.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Click p95 (ms) | 422.8 | 65.5 | -357.3 | -84.5 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Slowest click (ms) | 422.8 | 65.5 | -357.3 | -84.5 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Cold startup (ms) | 633.0 | 356.1 | -277.0 | -43.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Warm startup (ms) | 608.9 | 343.3 | -265.5 | -43.6 | 15.9 | Within margin |
| Point update (ms) | 739.6 | 48.9 | -690.7 | -93.4 | 4.2 | Not assessed · Paired WebGL runs drifted beyond the control limit |
| Topology update (ms) | 1199.4 | 266.4 | -932.9 | -77.8 | 4.2 | Within margin |
| Full replacement (ms) | 1200.3 | 241.3 | -959.0 | -79.9 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Resize (ms) | 930.6 | 50.0 | -880.6 | -94.6 | 4.2 | Not assessed · Paired WebGL runs drifted beyond the control limit |
| Rectangle p95 (ms) | 1339.6 | 40.3 | -1299.4 | -97.0 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Polygon p95 (ms) | 1251.8 | 19.8 | -1232.1 | -98.4 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Moving labels p95 (ms) | 1481.8 | 45.9 | -1435.8 | -96.9 | 5.7 | Not assessed · Paired WebGL runs drifted beyond the control limit |
| Peak tracked memory (MiB) | 543.0 | 200.1 | -343.0 | -63.2 | 1.0 | Within margin |

The steady-motion confirmation used the same window and intervals. The two
new WebGL controls reached 151.4 and 151.8 ms p95. Both independent pairs
then met the declared motion margin.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms), confirmation | 151.7 | 68.5 | -83.2 | -54.8 | 4.2 | Within margin |

## YouTube · 1,000,000 points, 2,852,734 edges

Both WebGL controls completed the moving window at 949.4 and 935.1 ms p95.
Both returned no usable first moving rectangle selection, so neither full
control reached the later queries, updates and warm-start measurements.
The table uses the first partial control and one complete WebGPU run.
WebGPU completed all eight region queries and 1,000 moving label positions per
request. In both renderers, the independently moving graph filled the
viewport. The three intended background clicks actually hit points, and the
nine planned point clicks returned their intended IDs in all three runs.

The earlier 51.9 ms WebGPU YouTube result used the simpler line-list view.
This study includes width, blending and distance-dependent opacity from the
matched Viewer Comparison renderer. [Earlier YouTube run](#/million-graph?section=doc-production-envelope)

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms) | 949.4 | 284.4 | -665.0 | -70.0 | — | Not assessed · Missing a complete matched pair |
| Interaction frame p95 (ms) | 2450.1 | 200.8 | -2249.3 | -91.8 | — | Not assessed · Missing a complete matched pair |
| First click (ms) | 2228.3 | 131.1 | -2097.2 | -94.1 | — | Not assessed · Missing a complete matched pair |
| Click p95 (ms) | 4127.8 | 210.3 | -3917.5 | -94.9 | — | Not assessed · Missing a complete matched pair |
| Slowest click (ms) | 4127.8 | 210.3 | -3917.5 | -94.9 | — | Not assessed · Missing a complete matched pair |
| Cold startup (ms) | 1619.7 | 816.6 | -803.1 | -49.6 | — | Not assessed · Missing a complete matched pair |
| Warm startup (ms) | — | 832.8 | — | — | — | Not assessed · Missing a complete matched pair |
| Point update (ms) | — | 196.6 | — | — | — | Not assessed · Missing a complete matched pair |
| Topology update (ms) | — | 749.9 | — | — | — | Not assessed · Missing a complete matched pair |
| Full replacement (ms) | — | 1150.1 | — | — | — | Not assessed · Missing a complete matched pair |
| Resize (ms) | — | 316.6 | — | — | — | Not assessed · Missing a complete matched pair |
| Rectangle p95 (ms) | — | 204.7 | — | — | — | Not assessed · Missing a complete matched pair |
| Polygon p95 (ms) | — | 229.9 | — | — | — | Not assessed · Missing a complete matched pair |
| Moving labels p95 (ms) | — | 229.9 | — | — | — | Not assessed · Missing a complete matched pair |
| Peak tracked memory (MiB) | 994.8 | 284.9 | -709.9 | -71.4 | — | Not assessed · Missing a complete matched pair |

## YouTube capacity

The largest tested YouTube workload that completed the entire workflow on
both backends had **262,144 points and 1,369,771 edges**. That is a tested
size for the specific workload and interactions below. The exact limit between
the tested sizes is unknown.

| Points | Edges | Production WebGL outcome | Lab WebGPU outcome |
| ---: | ---: | --- | --- |
| 1,000,000 | 2,852,734 | Two full attempts drew and moved the graph, then stopped at the first rectangle selection. | Full workflow completed. |
| 786,432 | 2,505,230 | Short check drew and moved the graph. Both area queries returned null and both label results were incomplete. | Short workflow completed. |
| 524,288 | 1,915,970 | Short check returned the rectangle and its 1,000 labels. The polygon returned null and that label result was incomplete. | Short workflow completed. |
| 262,144 | 1,369,771 | The short check and all four full sessions completed. | The short check and both full sessions completed. |

The shorter checks use eight measured intervals, four clicks and one query
per shape. After a missing result the runner continues independent checks.
WebGL completed sparse and full updates and resize at the two incomplete
short-check sizes. Its area-readback helper caps its GPU fence wait at one
second. The missing results are consistent with that wait expiring under
load. The captures did not instrument the fence outcome.

At 262,144 points, both backends returned the planned point and background
results in each pair and produced 1,000 moving label positions per request.
Both independently moving pictures showed similar large structures with
different small details. The full comparison keeps the WebGL control drift
and measured timings together.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms) | 274.2 | 124.4 | -149.8 | -54.6 | 4.2 | Not assessed · Paired WebGL runs drifted beyond the control limit |
| Interaction frame p95 (ms) | 390.9 | 50.9 | -340.0 | -87.0 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| First click (ms) | 464.3 | 49.9 | -414.4 | -89.3 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Click p95 (ms) | 464.3 | 50.1 | -414.2 | -89.2 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Slowest click (ms) | 464.3 | 50.1 | -414.2 | -89.2 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Cold startup (ms) | 666.1 | 442.1 | -224.0 | -33.6 | 33.2 | Within margin |
| Warm startup (ms) | 642.5 | 432.9 | -209.6 | -32.6 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Point update (ms) | 795.0 | 31.8 | -763.3 | -96.0 | 4.2 | Within margin |
| Topology update (ms) | 1264.9 | 284.4 | -980.6 | -77.5 | 4.2 | Within margin |
| Full replacement (ms) | 1504.8 | 408.3 | -1096.5 | -72.9 | 142.9 | Within margin |
| Resize (ms) | 1499.1 | 107.3 | -1391.8 | -92.8 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Rectangle p95 (ms) | 1393.8 | 24.6 | -1369.2 | -98.2 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Polygon p95 (ms) | 1253.4 | 16.9 | -1236.4 | -98.6 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Moving labels p95 (ms) | 1557.8 | 24.7 | -1533.1 | -98.4 | — | Not assessed · WebGL A/A varied more than the user-impact limit |
| Peak tracked memory (MiB) | 432.7 | 132.5 | -300.2 | -69.4 | 1.0 | Within margin |

The motion confirmation again left a wide gap but failed the control stability
test. WebGL controls reached 283.3 and 282.2 ms p95, and the paired WebGL
observations were 482.1 and 267.2 ms. Both WebGPU observations stayed near 117 ms.

| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Steady frame p95 (ms), confirmation | 374.6 | 117.1 | -257.5 | -68.7 | 4.2 | Not assessed · Paired WebGL runs drifted beyond the control limit |

## Raw captures

The Lab's ignored `captures/` directory holds each run's source archive with
SHA-256, control checksum, input fingerprint, motion and click intervals,
allocation samples, error stage and checkpoint images. The base source was
`0f62ffc99`. The control UMD checksum was
`71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d`.

| Workload | Capture directory | Source archive SHA-256 |
| --- | --- | --- |
| Karate Club | `migration-karate-34-2026-11-20T14-40-32-853Z` | `e84e2c52f2784a6757466aeff167cba9f1857cd0b67487d45d28971075c77809` |
| Dense communities | `migration-dense-1000000-2026-11-20T14-40-59-350Z` | `1729e1d59d5fca43a50a32564dd395e867131fad66052854c0038ee7449206d2` |
| Hub communities | `migration-hubs-1000000-2026-11-20T14-44-34-016Z` | `a2fceb3f522705c006e2f9ae4c97a30543a99431d1d4871c4d5d62576286d2e2` |
| Hub motion confirmation | `migration-hubs-1000000-2026-11-20T14-53-38-860Z-steady-only` | `acd692c6b4f942b2ea560ab5eadcddfc3a59d4182fbabf044a00a6b263089a2d` |
| YouTube | `migration-youtube-1000000-2026-11-20T14-48-10-189Z` | `1150b31c6af3cf6620e7e69d19521297a98b183c287142a2f5de7134d2aa78ae` |
| YouTube, 786,432-point capacity check | `migration-youtube-786432-2026-11-20T14-55-21-888Z-smoke` | `afa47ff0946e1f55e6de77b38631261a0e77f01d4fe3ca0fe0684f5398fbca96` |
| YouTube, 524,288-point capacity check | `migration-youtube-524288-2026-11-20T14-58-34-804Z-smoke` | `8eb2dfe833e7e89e881b93ca6200cbe3c78b1626ecac1f2af203c00d22ca553c` |
| YouTube, 262,144-point capacity check | `migration-youtube-262144-2026-11-20T14-59-34-552Z-smoke` | `82f026279397def455558faf14e95617791e028b0aca661163ff6293ec9ab545` |
| YouTube, 262,144-point full comparison | `migration-youtube-262144-2026-11-20T15-00-05-748Z` | `50dc4a56a4836418ef57c67e6cd26abc4b0039fe357af487f2998e1ae49e6c19` |
| YouTube, 262,144-point motion confirmation | `migration-youtube-262144-2026-11-20T15-04-21-784Z-steady-only` | `808ea668e3751699384db6d6bcb0a95e78b35c1b4b069fa829e9761eab146b1a` |
