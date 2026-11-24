On Apple M3, updating the highlights after a drag on the million-point YouTube graph took **7.2 ms** on WebGPU. The median was **211.6 ms** in the fresh control and **290.7 ms** in the earlier replay. WebGPU returned every expected ID and all 1,000 tracked coordinates at both graph sizes. Completing the highlighted graph frame and giving the labels a paint opportunity still took close to one second from release on the million-point graph.

## Workload

The 65,536-point graph contains 432,898 links. The million-point graph contains 2,852,734. Both use the induced SNAP YouTube topology, a 961 × 541 CSS pixel canvas at pixel ratio 2, and a fixed camera at zoom 0.25. The four drags include a large central rectangle, a small rectangle, an off-center rectangle and a reverse drag. Each release requests the rectangle's IDs and the positions of the same 1,000 tracked point IDs.

In the correctness runs, a full position copy is also requested in the release handler. A separate calculation projects the live points into CSS space and includes each two-pixel point whose footprint meets the rectangle. It checks for missing, extra and out-of-order IDs and verifies the tracked coordinates against their indexed positions. The seeded inputs and gestures match across packages. The two simulations advance independently, so their exact release ticks and selected IDs can differ. Runs that measure latency omit the full copy.

The selection IDs are Cosmos point indices in the prepared graph. The tracked IDs are spaced across the whole index range. Storybook's `CosmosLabels` receives the 1,000 returned coordinates, projects them and lets its label renderer cull overlaps. A correct read therefore covers more points than the number of labels visible at once.

## Correctness at release

Each cell gives the number of selected points. On every successful release the complete ordered list matched and all 1,000 labels had the exact expected ID and XY coordinates.

| Points | Package | Large rectangle | Small rectangle | Off-center | Reverse drag |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 65,536 | 847 | 4,558 | 0 |
| 65,536 | WebGPU | 65,536 | 13,805 | 695 | 0 |
| 1,000,000 | WebGL async | Timeout | Timeout | Timeout | Timeout |
| 1,000,000 | WebGPU | 684,396 | 13,705 | 146,395 | 23,688 |

The million-point WebGL release snapshots contained 463,961, 7,174, 87,968 and 9,354 points inside the four rectangles. Both async APIs returned null. In the corresponding WebGPU session, 103–130 labels remained in the overlay after culling.

When the older and newer WebGPU builds released the four drags at the same simulation ticks, the complete ordered ID lists matched across builds at both sizes. The matched ticks were 6, 10, 14 and 18 at 65,536 points, and 10, 26, 40 and 54 at one million. All 1,000 tracked coordinates matched the corresponding release snapshot on every drag.

A separate million-point replay with synchronous WebGL queries returned all expected ordered IDs and all 1,000 label coordinates on every drag. The selection call alone blocked JavaScript for 3.61–6.48 seconds per release.

## Latency on M3

Each value is the median in milliseconds across eight timed releases per package and size. Each package ran alone in visible Chrome 158. The two four-drag blocks reversed package order. Arrows compare the previous WebGPU setter with the new one. WebGL values come from the latest replay.

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
