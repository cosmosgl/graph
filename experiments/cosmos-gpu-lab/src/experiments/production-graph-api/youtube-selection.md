On Apple M3, a million-point selection could wait behind several frames drawing 2.85 million links. WebGPU now limits automatic frames in flight and uses a smaller shader for solid blended links. At the same four release ticks, feedback took 0.46–0.90 seconds. The original build took 1.51–4.99 seconds.

## Workload

The 65,536-point graph contains 432,898 links. The million-point graph contains 2,852,734. Both use the induced SNAP YouTube topology, a 961 × 541 CSS pixel canvas at pixel ratio 2, and a fixed camera at zoom 0.25. The four drags include a large central rectangle, a small rectangle, an off-center rectangle and a reverse drag. Each release requests the rectangle's IDs and the positions of the same 1,000 tracked point IDs.

In the correctness runs, a full position copy is also requested in the release handler. A separate calculation projects the live points into CSS space and includes each two-pixel point whose footprint meets the rectangle. It checks for missing, extra and out-of-order IDs and verifies the tracked coordinates against their indexed positions. The seeded inputs and gestures match across packages. The two simulations advance independently, so their exact release ticks and selected IDs can differ. Runs that measure latency omit the full copy.

The selection IDs are Cosmos point indices in the prepared graph. The tracked IDs are spaced across the whole index range. Storybook's `CosmosLabels` receives the 1,000 returned coordinates, projects them and lets its label renderer cull overlaps. A correct read therefore covers more points than the number of labels visible at once.

## Correctness at release

Each cell gives the number of selected points. On every successful release the complete ordered list matched and all 1,000 labels had the exact expected ID and XY coordinates.

| Points | Package | Large rectangle | Small rectangle | Off-center | Reverse drag |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 65,536 | 725 | 5,648 | 0 |
| 65,536 | WebGPU | 65,536 | 13,805 | 695 | 0 |
| 1,000,000 | WebGL async | Timeout | Timeout | Timeout | Timeout |
| 1,000,000 | WebGPU | 684,396 | 11,131 | 117,598 | 17,774 |

The million-point WebGL release snapshots contained 434,117, 5,811, 84,913 and 9,197 points inside the four rectangles. Both async APIs returned null. In the corresponding WebGPU session, 102–130 labels remained attached to the overlay after culling on each release.

An earlier synchronous WebGL diagnostic returned all the expected IDs and label coordinates at one million points. It blocked JavaScript for 3.73–4.61 seconds per release.

## Latency on M3

Each value is the median in milliseconds across eight timed releases per package and size. Each package ran alone in visible Chrome 158. The two four-drag blocks reversed package order.

| Points | Package | Selection read | 1,000-label read | Highlight setter | Label redraw | Release to feedback |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 423.6 | 479.9 | 1.0 | 5.2 | 640.7 |
| 65,536 | WebGPU | 12.6 | 10.8 | 24.5 | 2.5 | 83.3 |
| 1,000,000 | WebGL | 1,008.4 to null | 1,006.5 to null | Unavailable | Unavailable | Unavailable |
| 1,000,000 | WebGPU | 429.5 | 390.2 | 290.7 | 13.7 | 1,345.0 |

At one million points on WebGPU, the two readbacks together took 430 ms at the median. Feedback ranged from 1.07 to 2.23 seconds. On WebGL, both queries returned null on every timed release after the package's one-second fence timeout.

The before/after comparison below uses separate WebGPU-only runs with identical session order, the same four native gestures and eight timed releases per size. Values are medians in milliseconds.

| Points | Both readbacks ready, before → final | Highlight setter start to completed frame, before → final | Release to feedback, before → final |
| ---: | ---: | ---: | ---: |
| 65,536 | 173.8 → 10.5 | 187.8 → 82.8 | 368.7 → 91.3 |
| 1,000,000 | 1,158.8 → 476.9 | 878.0 → 726.4 | 2,065.9 → 1,211.1 |

## Why the queries waited

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

Gestures replayed at their ordinary speed reach an earlier, less settled layout under pacing. Link length and selected counts change as the simulation progresses. The highlight setter still rebuilds point and link style buffers. Those costs remain in the ordinary release timings.

## What the timings measure

- **Selection and label readback** start in the same pointer-release handler. Each duration ends when that public async call returns to JavaScript. Both calls finish before the highlight or label update starts. The two read durations overlap.
- **Highlight update** measures the synchronous call to `setConfigPartial({ highlightedPointIndices })`. **Label redraw** measures the synchronous call to `CosmosLabels.update`, including projection and label drawing.
- **Feedback** runs from release until both a browser paint opportunity and GPU completion of the next highlighted graph frame have been observed. Two animation-frame callbacks give the overlay a paint opportunity. A GPU fence marks the graph work and is checked on animation frames. The display's actual presentation time can differ.
