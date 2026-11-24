Four pointer drags select rectangles on the moving YouTube graph. At 65,536 points, both packages returned every expected point ID and all 1,000 tracked coordinates on every release. At one million points the moving WebGL control returned null for both async reads. WebGPU returned usable results while the simulation kept running.

## Workload

The 65,536-point graph contains 432,898 links. The million-point graph contains 2,852,734. Both use the induced SNAP YouTube topology, a 961 × 541 CSS pixel canvas at pixel ratio 2, and a fixed camera at zoom 0.25. The four drags include a large central rectangle, a small rectangle, an off-center rectangle and a reverse drag. Each release requests the rectangle's IDs and the positions of the same 1,000 tracked point IDs.

In the correctness runs, a full position copy is also requested in the release handler. A separate calculation projects the live points into CSS space and includes each two-pixel point whose footprint meets the rectangle. It checks for missing, extra and out-of-order IDs and verifies the tracked coordinates against their indexed positions. The seeded inputs and gestures match across packages. The two simulations advance independently, so their exact release ticks and selected IDs can differ. Runs that measure latency omit the full copy.

The selection IDs are Cosmos point indices in the prepared graph. The tracked IDs are spaced across the whole index range. Storybook's `CosmosLabels` receives the 1,000 returned coordinates, projects them and lets its label renderer cull overlaps. A correct read therefore covers more points than the number of labels visible at once.

## Correctness at release

Each cell gives the number of selected points. On every successful release the complete ordered list matched and all 1,000 labels had the exact expected ID and XY coordinates.

| Points | Package | Large rectangle | Small rectangle | Off-center | Reverse drag |
| ---: | --- | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 65,536 | 2,170 | 4,073 | 0 |
| 65,536 | WebGPU | 65,536 | 954 | 2,348 | 0 |
| 1,000,000 | WebGL async | Timeout | Timeout | Timeout | Timeout |
| 1,000,000 | WebGPU | 425,629 | 3,953 | 42,255 | 4,705 |

The million-point WebGL release snapshots contained 463,961, 5,639, 77,011 and 8,341 points inside the four rectangles. Both async APIs returned null. In the corresponding WebGPU session, 67–128 labels remained attached to the overlay after culling on each release.

In a separate million-point WebGL replay, synchronous selection and tracked-position reads ran in the same release handler as the full snapshot. All four ordered lists matched (543,120, 5,811, 80,475 and 8,305 IDs), and every release returned all 1,000 exact label coordinates. The two reads together blocked JavaScript for 3.73–4.61 seconds per release. A second diagnostic that took a blocking snapshot first and then used the normal async APIs recovered three of four selections and label maps. These checks point to sensitivity to queued work. Their timings are separate from the interactive comparison.

## Latency on M3

Each value is the median in milliseconds across eight timed releases per package and size. Each package ran alone in visible Chrome 158. The two four-drag blocks reversed package order.

| Points | Package | Selection read | 1,000-label read | Highlight setter | Label redraw | Release to feedback |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 65,536 | WebGL | 620.5 | 692.9 | 1.0 | 6.5 | 855.5 |
| 65,536 | WebGPU | 262.8 | 258.3 | 34.2 | 3.3 | 564.1 |
| 1,000,000 | WebGL | 1,007.7 to null | 1,006.8 to null | Unavailable | Unavailable | Unavailable |
| 1,000,000 | WebGPU | 1,624.6 | 1,601.9 | 207.4 | 7.0 | 2,682.0 |

At one million points on WebGPU, the two readbacks together took 1.62 seconds at the median. The release-to-feedback range was **1.95–8.22 seconds**. The interval from starting the highlight setter to observing the next completed highlighted frame had a median of 1.11 seconds. It includes simulation, drawing and already queued work. On WebGL, both reads hit the package's one-second fence timeout on all eight timed releases. The caller could only show that selection was unavailable.

The WebGPU highlight setter calls the renderer's general update path, which repacks point attributes and links even when only the highlighted IDs changed. A highlight-only update is a specific optimization to test. The larger measured waits were for readback and the following graph frame.

## What the timings measure

- **Selection and label readback** start in the same pointer-release handler. Each duration ends when that public async call returns to JavaScript. Both calls finish before the highlight or label update starts. The two read durations overlap.
- **Highlight update** measures the synchronous call to `setConfigPartial({ highlightedPointIndices })`. **Label redraw** measures the synchronous call to `CosmosLabels.update`, including projection and label drawing.
- **Feedback** runs from release until both a browser paint opportunity and GPU completion of the next highlighted graph frame have been observed. Two animation-frame callbacks give the overlay a paint opportunity. A GPU fence marks the graph work and is checked on animation frames. The display's actual presentation time can differ.
