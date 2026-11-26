On Apple M3, the million-point wait for selected IDs and 1,000 label coordinates rose from **267 to 400 ms** in two ordinary WebGPU replays. Releasing the same four drags at the same simulation ticks gave **167.8 and 167.2 ms** on those builds. Most of the early-layout wait came from a frame already drawing 2.85 million links. Reducing that drawing work cut early readback from **290.5 to 247.1 ms** and release-to-feedback time from **843.5 to 531.3 ms** in fixed-tick timing runs.

## Workload

The 65,536-point graph contains 432,898 links. The million-point graph contains 2,852,734. Both use the induced SNAP YouTube topology, a 961 × 541 CSS pixel canvas at pixel ratio 2, and a fixed camera at zoom 0.25. The four drags include a large central rectangle, a small rectangle, an off-center rectangle and a reverse drag. Each release requests the rectangle's IDs and the positions of the same 1,000 tracked point IDs.

In the correctness runs, a full position copy is also requested in the release handler. A separate calculation projects the live points into CSS space and includes each two-pixel point whose footprint meets the rectangle. It checks for missing, extra and out-of-order IDs and verifies the tracked coordinates against their indexed positions. The seeded inputs and gestures match across packages. The two simulations advance independently, so their exact release ticks and selected IDs can differ. Runs that measure latency omit the full copy.

The selection IDs are Cosmos point indices in the prepared graph. The tracked IDs are spaced across the whole index range. Storybook's `CosmosLabels` receives the 1,000 returned coordinates, projects them and lets its label renderer cull overlaps. A correct read therefore covers more points than the number of labels visible at once.

## Continuously moving million-point rectangles on the signed packages

On M3, WebGPU returned ordered point IDs and all 1,000 tracked coordinates on all eight continuously moving million-point releases. WebGL returned `null` from both async queries at all eight releases. This held for both signed WebGPU builds below with the same WebGL control (`74a216a7`). In the latest run, WebGL took a median 1,006.9 ms for selection and 1,007.0 ms for labels before reporting the timeout.

| Median WebGPU time over eight releases | Earlier package (`b52a9c7f`) | Before the scheduling change (`c7c523be`) |
| --- | ---: | ---: |
| Release until selected IDs available | 265.4 ms | 250.9 ms |
| Release until 1,000 tracked coordinates available | 265.7 ms | 251.1 ms |
| Release until both queries complete | 265.7 ms | 251.1 ms |
| Apply the highlighted IDs | 8.8 ms | 7.6 ms |
| Redraw the labels | 9.9 ms | 9.1 ms |
| Highlight setter start until the highlighted GPU frame completes | 466.4 ms | 555.1 ms |
| Release until visible feedback | 695.4 ms | 775.8 ms |

Visible Chrome 158 replayed four trusted drags in fresh sessions, with both engine orders. During the latest replay WebGPU released at ticks 4, 7, 11, 15 and 4, 8, 11, 14. Both WebGL sessions released at ticks 9, 17, 25, 33. The layout kept moving and the timing runs omitted the full position copy. These values measure the observed workflows at those ticks. A paired million-point rectangle latency comparison requires a successful WebGL read. The earlier and latest timing captures are `captures/public-graph-youtube-tqhKGb/` and `captures/public-graph-youtube-CDH2Xg/`.

With the latest pair at 65,536 points, all four rectangle selections on each engine matched its independently projected release snapshot, including the empty selection. Every set of 1,000 tracked coordinates matched. The results are in `captures/public-graph-youtube-HYzAES/`. The fixed-tick lassos below check the million-point IDs and coordinates against each package’s own snapshot.

## A frame submitted between the two readbacks

At tick 10 on the million-point graph, the area call returned its IDs 278.5 ms after release. Chrome ran the next animation callback at 278.7 ms. The tracked-label call finished at 280.8 ms, and the app applied the highlights at 281.2 ms. The GPU already had a whole unhighlighted frame to draw. The same sequence occurred at tick 40 with only 2.7 ms between the callback and the label result.

WebGPU now gives pending Graph reads one eligible refresh after an area selection. This lets code awaiting both results apply the highlights before the next automatic simulation and draw. A second query cannot postpone that frame again. Explicit rendering and applications that only track points keep their existing schedule.

On M3, each comparison used four fresh browser sessions, with four trusted rectangle releases per session. We ran the packages in the order before, after, after, before. All four releases in each timing session returned ordered IDs and 1,000 labels.

| Million-point metric | Before | After |
| --- | ---: | ---: |
| Fixed tick 10, highlighted-frame completion in the two sessions | 585.4 / 592.3 ms | 323.8 / 315.9 ms |
| Fixed tick 40, highlighted-frame completion in the two sessions | 166.4 / 303.7 ms | 168.2 / 169.2 ms |
| Fixed ticks 10, 26, 40 and 54, extra frames queued before highlight | 3 of 8 | 0 of 8 |
| Fixed ticks, median release to feedback | 466.1 ms | 391.6 ms |
| Ordinary moving releases, median time until both reads finished | 242.2 ms | 256.6 ms |
| Ordinary moving releases, median highlight setter / label redraw | 9.6 / 10.2 ms | 9.4 / 10.4 ms |
| Ordinary moving releases, median setter to completed highlighted frame | 429.7 ms | 308.2 ms |
| Ordinary moving releases, median release to feedback | 646.6 ms | 551.3 ms |

The ordinary sessions used the normal gesture cadence, with no profiling fences. The two before sessions released at ticks 4/8/11/15 and 4/7/11/15. The after sessions released at 4/7/10/13 and 4/8/12/15. After the four fixed releases, every session produced the same two million XY coordinates, highlighted IDs and 1,922 × 1,082 RGBA pixels at tick 72. The timing probe used UMD `0db591b3`. The signed build from `951ec4d7`, UMD `6a6f1ceb`, differs only in two private Boolean field names, verified by comparing the complete bundles.

Separate full-copy rectangle replays returned identical ordered-ID and tracked-XY hashes before and after the change on all four drags at each size. The independent CPU projection agreed on every ID except million-point ID 334004 at tick 10. At its release position (1916.84619140625, 1178), the public CPU camera reports y = 488 for a one-pixel radius and a rectangle ending at y = 487. On the same 961 × 541 camera at 2×, **both real WebGL and WebGPU exclude the point at 487 and include it at 487.00001**. Both also excluded it at 486.99990 and 486.99999 and included it at 487.00010. The raw reports retain the ideal-projection mismatch. All 1,000 tracked XY pairs matched the release snapshot at every tick.

Capture directories under `captures/public-graph-youtube-*` use these suffixes in session order. The fixed-tick profiles are `HNvrtD/UclNLC/4CtMzc/Wlut2E`, the ordinary sessions are `Qgdvon/0KAzzI/kTIbdb/caWpeH` and the full-copy checks are `RzRF2Z/19tti3` (65,536) and `sYj2Dv/lwu4mo` (one million, before/after). The callback trace is in `QDxNU6`, and the one-point WebGL/WebGPU reproduction and both paired summaries are in `captures/cosmos-selection-frame-vg3saqgb/`.

The final signed WebGPU bundle `6a6f1ceb` also completed eight ordinary million-point rectangle drags against WebGL `74a216a7`. WebGPU returned ordered IDs and 1,000 label positions on every release. Median time to both reads was 250.7 ms. Updating the highlight took 9.4 ms on the CPU, redrawing the labels took 10.7 ms, and the completed highlighted frame arrived 303.1 ms after the highlight update began. Median release-to-feedback was 540.6 ms. Each stage has its own median. WebGL returned null for both reads on all eight releases. This run allowed the graphs to advance independently and omitted the full position copy. The fixed-tick replay above checks the boundary IDs and coordinates. The raw package run is in `captures/public-graph-youtube-CnOQq4/`.

## A 256-vertex lasso on the moving YouTube graph

On 26 November 2026, both real packages selected the expected IDs and returned all
1,000 tracked coordinates on each of four long-lasso drags at both graph sizes.
Chrome 158 on Apple M3 delivered the same 256 distinct CSS-pixel vertices to
each package. At pointer release, we compared the ordered selection with an
independent circle–polygon intersection check over the complete position array.
Every returned label position exactly matched its point in that array.

| Points | Package | Tick 10 | Tick 26 | Tick 40 | Tick 54 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 65,496 | 540 | 611 | 0 |
| 65,536 | WebGPU | 65,496 | 529 | 609 | 0 |
| 1,000,000 | WebGL | 251,132 | 2,208 | 27,256 | 2,494 |
| 1,000,000 | WebGPU | 251,241 | 2,207 | 27,273 | 2,494 |

The table counts selected IDs. The independently moving layouts produced
identical ID lists at ticks 10 and 54 on the smaller graph. All four
million-point lists differed between engines, including the two 2,494-point
lists. The tracked-position digests also differed between engines at every
checkpoint. In all 16 releases, the comparison against each engine's own
positions found zero missing IDs, extra IDs or incorrect label coordinates.

The driver held each requested simulation tick until the path arrived and
resumed motion after submitting all three async reads. WebGL completed its
million-point reads in this replay. The earlier continuously moving rectangle
timing runs used a different queue state. The experiment's `agent-recipe.md`
lists the replay commands and four capture digests.

An earlier M3 replay used WebGL `1b589639` and WebGPU `b5236d3c`.
All eight WebGPU releases and seven of eight WebGL releases returned the same
ordered IDs and 1,000 tracked coordinates as the earlier run and matched
their own complete release snapshots. At tick 10 on the million-point graph,
the WebGL selection timed out on both async attempts. Its label query timed
out on the first attempt and returned all 1,000 correct coordinates on retry.
The synchronous WebGL control matched all four releases, including 251,132
IDs and all 1,000 coordinates at tick 10. The six reports and their hashes
are indexed in `captures/final-youtube-lasso-w68QsF/summary.json`.

The signed release candidate repeated all 16 drags on M3 with WebGL
`74a216a7` and the installed WebGPU standalone `b52a9c7f`. All 16 async
selections and all 1,000 tracked coordinates on each release matched their
own full-position snapshot. Every ordered ID-list and label-coordinate
digest also matched its earlier same-engine result, including the WebGL
blocking control above. At million-point tick 10 the WebGL selection
and labels took 2.87 and 3.78 seconds from release on this run. The
earlier timeouts remain relevant to interactive latency. The raw data and
full hashes are in `captures/public-graph-youtube-Swh4J0/result.json`.

The signed WebGPU package with live pointer filtering and preserved style transitions (`c7c523be`) repeated the same 16 M3 drags with WebGL `74a216a7`. All ordered IDs and all 1,000 tracked coordinate pairs at each release matched the previous result for that engine. At million-point tick 10, the WebGL lasso selected 251,132 IDs and the WebGPU lasso selected 251,241. Each agreed with its own full position snapshot. The complete captures are in `captures/public-graph-youtube-AFEsny/`.

The sealed Graph with the selection scheduling change (`6a6f1ceb`) matched all eight previous WebGPU ID lists and all 1,000 tracked XY pairs per release on M3. Every list and coordinate also matched its own release snapshot. The unchanged WebGL package matched all four 65,536-point releases. At one million points, both WebGL async calls returned `null` at ticks 10 and 40 on the first attempt. The selection and label waits were 1,029 / 1,001 ms and 1,009 / 1,009 ms, consistent with their shared one-second fence timer. The other two releases passed.

A synchronous WebGL control and a fresh asynchronous session both matched all four million-point release snapshots and all the earlier WebGL digests. The successful async selection calls took 2.54–5.86 s. The first attempt, synchronous control and async retry are in `captures/public-graph-youtube-w85MaM/`, `captures/public-graph-youtube-9oUbPl/` and `captures/public-graph-youtube-SacgKz/`. The combined verdict and report hashes are in `captures/release-replays-951ec4d7-uojxj6dd/lasso-summary.json`.

After the config callback fix, the sealed Graph (`754a02b6`) matched all eight WebGPU lasso ID lists and all 1,000 tracked XY pairs per release on M3. WebGL matched seven of eight releases. At million-point tick 10 its asynchronous selection and label calls both returned `null` on the first attempt and the retry. The synchronous control recovered all four million-point results, including the 251,132 IDs at tick 10. In the separate million-point rectangle replay, the completed highlight at tick 72 matched every frozen coordinate, selected ID and RGBA byte from the previous WebGPU build. Per-release results and capture paths are in `captures/qualify-9891baf1-nbusa0pa/lasso.json` and `feedback.json`.

## Why the readback wait changed

The 267.0 and 400.2 ms medians came from eight ordinary releases on each build. Both started at tick 4, but the older build reached tick 14 or 15 by the fourth drag and the newer build reached tick 13. Even at tick 4, readback varied between sessions. Those runs did not record how much of the submitted frame had finished when the pointer was released. Holding the same gestures to ticks 10, 26, 40 and 54 put both builds on the same layouts. The eight-release medians were then within one millisecond of each other.

Four earlier ticks expose the wait during a busy frame. Each cell compares the incremental-highlight control with the optimized renderer. Times are milliseconds in one instrumented session per build. Frame age tells how recently the draw was submitted when the pointer was released. The last column measures the time from observing completion of preceding GPU work until both public queries had returned, including callback scheduling.

| Release tick | Frame age at release | Prior GPU work completed after release | Both reads ready after release | Remaining time |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 4.5 → 7.2 | 303.8 → 220.4 | 315.3 → 239.7 | 11.5 → 19.3 |
| 8 | 3.1 → 23.7 | 329.9 → 235.2 | 332.5 → 242.9 | 2.6 → 7.7 |
| 12 | 2.4 → 5.7 | 309.9 → 245.1 | 313.4 → 248.9 | 3.5 → 3.8 |
| 16 | 3.9 → 5.1 | 303.2 → 260.4 | 309.8 → 267.5 | 6.6 → 7.1 |

At those four ticks the original highlight setter build returned both reads in 319, 318, 313 and 300 ms. In a separate run starting at tick 20, a drained queue took a median 28.2 ms to step the layout and 219.7 ms to draw points and links. Drawing points alone took 6.8 ms. These isolated measurements identify link drawing as the largest contributor. The frame-completion markers alone cannot separate simulation and draw on releases where both callbacks arrive together.

### What changed in the draw

An opaque point can completely cover a link on the final canvas. On eligible dense graphs, WebGPU first marks the fully opaque point pixels in the depth buffer, then uses those marks to skip covered link fragments. Translucent edges still blend. When all solid links share an RGB color, the renderer supplies that color once for the draw and preserves each link's own alpha. This work happens on the graph's canvas. The rectangle and label queries use their existing GPU algorithms.

In the uninstrumented timing sessions, each build ran the same four drags twice at the listed ticks. Each cell gives median milliseconds across all eight releases, from the incremental-highlight control to the optimized renderer.

| Points | Release ticks | Both reads ready | Highlight update | Label redraw | Release to feedback |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | 10, 26, 40, 54 | 25.4 → 22.8 | 1.2 → 1.1 | 3.8 → 4.7 | 79.3 → 77.6 |
| 1,000,000 | 4, 8, 12, 16 | 290.5 → 247.1 | 8.4 → 8.6 | 7.9 → 10.7 | 843.5 → 531.3 |
| 1,000,000 | 10, 26, 40, 54 | 167.2 → 158.7 | 9.1 → 9.1 | 5.8 → 9.1 | 411.7 → 371.9 |

In a separate WebGPU-only replay at ordinary pointer speed, million-point readback measured **241.8 → 244.2 ms**. Release to feedback fell from 874.5 to 730.2 ms. The fixed-tick improvement in readback was clearest on the early layout.

On the million-point graph the frozen frame completed in **147.6 → 137.8 ms** at tick 28 and **110.9 → 97.1 ms** at tick 72 (median of three draws). Both frozen canvases matched the control at every one of their 2,079,604 pixels. At ticks 10, 26, 40 and 54, the original package, the incremental-highlight package and the optimized renderer all returned identical ordered selections and identical Float32 XY coordinates for all 1,000 tracked IDs on every drag at both sizes.

## Correctness at release

Each cell gives the number of selected points in the latest replay of the WebGL package and WebGPU candidate, where each engine advanced independently. On every successful release the complete ordered list matched and all 1,000 labels had the exact expected ID and XY coordinates.

| Points | Package | Large rectangle | Small rectangle | Off-center | Reverse drag |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 65,536 | 1,559 | 4,143 | 0 |
| 65,536 | WebGPU | 65,536 | 13,805 | 695 | 0 |
| 1,000,000 | WebGL async | Timeout | Timeout | Timeout | Timeout |
| 1,000,000 | WebGPU | 684,396 | 11,131 | 117,598 | 17,774 |

The million-point WebGL release snapshots contained 463,961, 5,811, 80,475 and 8,341 points inside the four rectangles. Both async APIs returned null on all four correctness drags and all eight timed releases. In the corresponding WebGPU session, 102–130 labels remained in the overlay after culling.

In the earlier ordinary timing blocks accompanying that correctness comparison, WebGPU returned both reads in a median 8.0 ms at 65,536 points and 240.6 ms at one million. Median release-to-feedback times were 57.1 and 595.2 ms respectively. Those gestures advanced at their natural speed. The fixed-tick timing table above compares builds at the same layouts.

A separate million-point replay with synchronous WebGL queries returned all expected ordered IDs and all 1,000 label coordinates on every drag. These calls block JavaScript and run separately from the interactive timings.

## Highlight update on M3

The million-point WebGPU highlight setter fell from an earlier 290.7 ms to 7.2 ms. The tables show the fresh comparison of the full style rebuild and the incremental update. Each value is the median in milliseconds across eight timed releases per package and size, with each package running alone in visible Chrome 158. The two four-drag blocks reversed package order. WebGL values come from the incremental-highlight replay.

| Points | Package | Read selected IDs | Read 1,000 labels | Redraw labels |
| ---: | --- | ---: | ---: | ---: |
| 65,536 | WebGL | 435.6 | 485.6 | 6.6 |
| 65,536 | WebGPU | 10.5 → 11.2 | 7.9 → 11.1 | 2.7 → 3.0 |
| 1,000,000 | WebGL | 1,008.1 to null | 1,005.8 to null | Unavailable |
| 1,000,000 | WebGPU | 266.9 → 400.1 | 243.6 → 399.8 | 10.3 → 7.9 |

| Points | Package | Set highlights | Setter start to completed frame | Release to feedback |
| ---: | --- | ---: | ---: | ---: |
| 65,536 | WebGL | 1.0 | 124.3 | 629.0 |
| 65,536 | WebGPU | 27.1 → 1.1 | 73.5 → 55.5 | 83.5 → 66.8 |
| 1,000,000 | WebGL | Unavailable | Unavailable | Unavailable |
| 1,000,000 | WebGPU | 211.6 → 7.2 | 649.1 → 501.9 | 888.7 → 967.5 |

The million-point WebGPU setter took 4.2–32.7 ms across the eight releases. The combined wait for IDs and labels rose from 267.0 to 400.2 ms at the median. The next highlighted frame completed sooner after the setter started, but the median for the full interaction rose by 78.8 ms. In a separate WebGPU-only replay, the million-point setter fell from 191.7 to 9.0 ms while feedback rose from 879.8 to 1,053.6 ms. On WebGL, both million-point queries returned null on all eight timed releases.

The ordinary drags reached different simulation ticks. In the two million-point timing blocks the last drag landed at ticks 14 and 15 in the control and at tick 13 in both candidate runs. In a separate profile that held each drag until the same tick on both builds, feedback arrived 11–282 ms sooner across the four drags. Each fixed tick has one sample per build and includes extra GPU completion markers.

## Changing one highlighted point

At simulation tick 72, changing one ID in a 4,705-point selection took **3.6 ms** on the million-point graph. The previous setter took **201.2 ms**. Each measurement started with a drained GPU queue and a paused graph.

| Highlight operation | Setter, before → after (ms) | Setter start to GPU completion, before → after (ms) |
| --- | ---: | ---: |
| Apply 4,705 IDs | 242.6 → 4.3 | 271.8 → 4.8 |
| Remove one ID | 201.2 → 3.6 | 237.8 → 4.2 |
| Restore that ID | 208.8 → 3.4 | 242.3 → 4.0 |
| Clear highlights | 158.0 → 3.5 | 195.5 → 4.1 |

The previous setter rebuilt styles for one million points and 2,852,734 links on each call. WebGPU now compares the new highlighted IDs with the previous selection and updates the color and grey-out state of points whose membership changed. The first selection can dim almost the entire graph. A one-ID edit changes one point's style. Both use the existing point and link buffers. To keep highlighted points on top for drawing and picking, the CPU can still scan the full draw order and upload the span of indices that moved. The entire order is 4 MB at one million points.

At this tick the two builds had identical values for all 2,000,000 position coordinates. After clearing and reapplying the original selection, every RGBA pixel matched across the 1,922 × 1,082 graph canvases (2,079,604 pixels). The release-time checks verify the separate label overlay's input coordinates.

## Earlier queue and shader changes

Before optimizing the setter, WebGPU reduced the number of frames waiting on the GPU and the cost of drawing solid links. The earlier WebGPU-only replay used eight timed releases per size. Values are medians in milliseconds.

| Points | Both reads ready, before → after | Setter start to completed frame, before → after | Release to feedback, before → after |
| ---: | ---: | ---: | ---: |
| 65,536 | 173.8 → 10.5 | 187.8 → 82.8 | 368.7 → 91.3 |
| 1,000,000 | 1,158.8 → 476.9 | 878.0 → 726.4 | 2,065.9 → 1,211.1 |

On the original build each animation-frame callback could submit a fresh simulation step and draw, even while earlier frames were running. GPU completion markers placed immediately before the two queries found four or five automatic frames outstanding on all four million-point releases. Prior submissions took 625–2,192 ms to acknowledge, accounting for 79–100% of the observed time until both answers arrived. Work also accumulated while the caller awaited the answers.

The WebGPU loop now admits one automatic frame at a time. It keeps a pending redraw across a pause and lets the host drive manual frames directly. The same GPU markers found one outstanding frame at each release in the paced replay.

Pacing alone left expensive draws. On the early moving layout, one full draw with an empty queue took a median 505 ms, a points-only draw took 8 ms and a simulation step took 40 ms. The solid-link color pass now carries only color, distance across the stroke and antialiasing width into its fragment shader. It shares the original strip geometry and blending. At fixed tick 72, the median of three completed draws fell from **146.0 to 102.6 ms**. All two million position coordinates and all **2,079,604 RGBA pixels** matched the paced build with the original shader.

With the four drags released at the **same simulation ticks** in both builds, the full ordered selection digests matched across builds. Both correctness runs also checked all 1,000 tracked coordinates against their own snapshots at each release. The table shows milliseconds for each instrumented drag.

| Million-point release tick | Both reads, before → final | Highlight setter start to completed frame, before → final | Release to feedback, before → final |
| ---: | ---: | ---: | ---: |
| 10 | 2,200 → 296 | 2,791 → 608 | 4,991 → 903 |
| 26 | 1,299 → 197 | 1,374 → 428 | 2,673 → 625 |
| 40 | 903 → 121 | 739 → 383 | 1,642 → 504 |
| 54 | 794 → 110 | 713 → 350 | 1,507 → 460 |

Gestures replayed at their ordinary speed can reach an earlier, less settled layout under pacing. Link length and selected counts change as the simulation progresses. The builds in this queue comparison both rebuilt point and link styles on each highlight update.

## What the timings measure

- **Selection and label readback** start in the same pointer-release handler. Each duration ends when that public async call returns to JavaScript. Both calls finish before the highlight or label update starts. The two read durations overlap.
- **Highlight update** measures the synchronous call to `setConfigPartial({ highlightedPointIndices })`. **Label redraw** measures the synchronous call to `CosmosLabels.update`, including projection and label drawing.
- **Feedback** runs from release until both a browser paint opportunity and GPU completion of the next highlighted graph frame have been observed. Two animation-frame callbacks give the overlay a paint opportunity. A GPU fence marks the graph work and is checked on animation frames. The display's actual presentation time can differ.
