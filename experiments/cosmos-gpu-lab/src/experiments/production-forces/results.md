Six small single-force fixtures matched every live coordinate at ticks 0, 1, 4 and 8 on both tested adapters. Centering differed by at most 0.000244140625 graph units per axis. All nine fixtures, including the combined case, kept the pin fixed and the absent slot absent.

| Force | Apple M3, largest coordinate difference | SwiftShader, largest coordinate difference |
| --- | ---: | ---: |
| Gravity | 0 | 0 |
| Center | 0.000244140625 | 0.000244140625 |
| Weighted springs | 0 | 0 |
| Pointer repulsion | 0 | 0 |
| Attractors | 0 | 0 |
| Clusters | 0 | 0 |
| All-pairs repulsion | 0 | 0 |

At tick 8, three of the seven present point positions differed in the M3 center case and two differed on SwiftShader. The maximum difference is one float32 spacing at coordinate 2,048. The WebGL center sums point positions using additive blending. The WebGPU center sums groups of points in a parallel reduction, which can change floating-point summation order.

The pointer case exposed a missing update. With the internal loop disabled, WebGL moved the point at x = 2,088 to 2,092 on the first right-button step. The earlier WebGPU package left it at 2,088. The corrected package handles both a manual step and a paused frame while the right button is held. Both graphs then held their tick-4 positions through tick 8 after release.

## Springs, repulsion and collision

Both packages returned identical coordinates, including after the original contact resolved. The maximum per-axis difference and paired RMS distance were zero at ticks 0, 1, 4 and 8 on Apple M3 and SwiftShader. The following graph-unit measurements agreed on both adapters. RMS movement is relative to the preceding row.

| Tick | Penetration of points 1 and 2 | Link 0 length | Link 1 length | RMS movement |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 18.055728 | 103.774 | 104.995 | 0 |
| 1 | 0.000084 | 96.023 | 84.498 | 12.908 |
| 4 | 0 | 88.453 | 68.480 | 17.884 |
| 8 | 0 | 81.645 | 64.596 | 9.151 |

Removing springs, repulsion or collision individually from the WebGL run changed the largest final coordinate by 80.594, 4.249 and 5.082 graph units, respectively. Each force contributed to the measured trajectory.

At tick 8 both canvases painted the gold link at its new midpoint (79, 61), background at the old midpoint (72, 84), and the orange point over the incident link at (44, 40). The public clicks returned link 0, background and point 0 there in both packages. Resetting and advancing eight steps individually reproduced every final coordinate, all three RGBA samples and the same click results as a single batch. Both previews also accepted real pointer clicks at desktop and narrow widths. These measurements cover one small graph with direct repulsion.

## Hierarchical repulsion

Both packages spread the same 8,192-slot cloud from an RMS radius of 51.210 graph units to about 118. Their first step moved points by about 22 graph units RMS. Their last step moved points by about 0.011. At tick 32 the matched point pairs differed by about 1.035 graph units RMS, or 0.88% of the reference radius. The largest single coordinate difference was 12.6354 graph units on both adapters. All 8,190 movable points differed.

| Adapter | WebGL / WebGPU final RMS radius | WebGL / WebGPU final single-step RMS motion | Paired final RMS position difference |
| --- | ---: | ---: | ---: |
| Apple M3 | 118.1048 / 118.3848 | 0.010832 / 0.010895 | 1.03450 |
| SwiftShader | 118.1048 / 118.3848 | 0.010832 / 0.010896 | 1.03465 |

These figures are from the earlier WebGPU tree approximation. With the new grid, the paired RMS position difference on the same M3 cloud at tick 32 was 0.00223 graph units. [Spread and settling checks](#/production-forces?section=doc-method)

## Lasso Selection in both Storybooks

The 22,500-point story starts its 25 color groups in a small square. On Apple M3 the old WebGPU force expanded the cloud less on the first tick and left individual points moving visibly after the groups formed. In the Lab replay, fixed seeds for the mesh and simulation give both engines identical starting positions. Opening the story normally generates fresh positions each time. The table gives the radius around the layout center that contains 90% of the points, in graph units.

| Simulation tick | WebGL | Previous WebGPU | WebGPU with the grid |
| ---: | ---: | ---: | ---: |
| 0 | 22.97 | 22.97 | 22.97 |
| 1 | 3,265.64 | 2,859.68 | 3,265.64 |
| 10 | 642.41 | 651.42 | 642.34 |
| 60 | 1,048.07 | 1,052.84 | 1,048.29 |
| 240 | 1,040.25 | 1,039.61 | 1,040.08 |

Across ticks 240–248, the RMS movement per point per tick, after subtracting each color group's translation, was **0.04383** on WebGL, **0.79801** on the previous WebGPU force and **0.04374** with the grid. The distance between corresponding point IDs was 0.032 units RMS after one tick and 6.95 units at tick 240. The two implementations accumulate cell positions differently. At the story zoom of 0.4 the latter distance is about 2.8 CSS pixels.

### What the shimmer fix costs on M3

During expansion, a simulation step and draw completed in a median **7.80 ms on WebGL** and **2.50 ms on corrected WebGPU**. After settling, the medians were **4.80 ms** and **1.90 ms**. The earlier WebGPU force took 1.30 ms on the settled layout. Across the three trial orders, the corrected WebGPU medians ranged from 1.80 to 2.00 ms, the earlier WebGPU medians from 1.20 to 1.40 ms, and WebGL from 4.80 to 4.85 ms.

| Measurement in ms, median / p95 | WebGL | WebGPU before fix | WebGPU after fix |
| --- | ---: | ---: | ---: |
| Step and draw during expansion, ticks 2–25 | 7.80 / 13.60 | 1.55 / 2.80 | 2.50 / 5.90 |
| Settled simulation step, ticks 241–264 | 4.70 / 5.50 | 1.20 / 1.70 | 1.70 / 2.20 |
| Settled draw alone | 0.70 / 1.20 | 0.70 / 1.00 | 0.70 / 1.00 |
| Settled step and draw together | 4.80 / 5.70 | 1.30 / 1.70 | 1.90 / 2.40 |
| Settled interval between automatic updates | 16.75 / 18.30 | 16.70 / 18.30 | 16.65 / 18.60 |

The extra work showed up in simulation. In three pairs starting from identical corrected WebGPU positions at tick 240, the next step took a median **2.00 ms** with repulsion enabled and **1.00 ms** with it disabled. This probe times grid construction, distant-cell forces and nearby point sampling together.

Startup was more expensive on all three builds. The first manual simulation step in a fresh graph took 22.7 ms on WebGL, 7.4 ms on the old WebGPU force and 14.4 ms on the corrected one (three-trial medians). In the normal preview loop the interval from tick 1 to tick 2 on corrected WebGPU was 29.8–32.4 ms. All 72 settled intervals on each engine were below 20 ms.

One foreground graph ran at a time in Chrome 158 at 680 × 536 and DPR 1. Each expansion and settled row pools 72 samples. The manual timer starts before the Graph call and stops when the browser observes GPU completion. The empty-fence median was 0.6 ms on WebGL and 0.1 ms on corrected WebGPU. Each combined frame has one completion wait. The automatic interval measures the story's simulation callbacks. The driver `scripts/lasso-story-timing.mjs` seeds the inputs only in its own benchmark pages.

## Native runtime at 8,192 slots

The following timings are from the earlier WebGPU tree approximation. The same public application used one manual step, one paused draw and one awaited full position readback per sample. Visible Chrome ran a single Graph at a time on the M3. Each trial used a fresh graph, four warm-up updates and 24 timed updates at ticks 5 through 28.

| Trial | Median milliseconds per update | 95th percentile |
| --- | ---: | ---: |
| WebGL control, first | 12.9 | 14.4 |
| WebGPU | 1.5 | 1.8 |
| WebGL control, repeat | 12.7 | 17.8 |

The measurements include browser scheduling, GPU submission and position transfer. Rendering used a 288 × 192 canvas at pixel ratio 1.

## Dense communities and the movable hub

With the new grid the native M3 replay measured a paired RMS distance at tick 100 of 0.52 units for dense communities and 2.43 units for the hub, respectively 0.016% and 0.075% of the WebGL RMS radius. Both packages retained the same fraction of each community at every checkpoint and passed the paint, pick, pin and topology checks. [Layout checks and thresholds](#/production-forces?section=doc-scale-method)

The table below records the earlier WebGPU tree comparison on the same graphs. Both packages preserved all 127 pins, the absent slot and all 8,182 ordered links. Distances are in graph units.

| At tick 100 | Dense WebGL | Dense WebGPU | Hub WebGL | Hub WebGPU |
| --- | ---: | ---: | ---: | ---: |
| RMS radius | 3,216.80 | 3,217.31 | 3,225.84 | 3,228.54 |
| RMS motion during the last step | 0.446 | 0.701 | 0.569 | 1.008 |
| RMS spring-length error | 25.98 | 26.14 | 26.76 | 27.04 |
| Overlapping pairs | 13,797 | 13,210 | 15,121 | 16,711 |
| RMS penetration among overlapping pairs | 0.676 | 0.956 | 0.780 | 1.126 |

The largest paired RMS errors occurred at tick 100. Dense communities reached 7.08 units, or 0.220% of the WebGL radius. The hub reached 14.20 units, or 0.440%. The dense graph's largest source group contained 65 links. In the hub graph, free point 2 was the source of 1,023 links and the endpoint of one more. It moved 58.04 units in WebGL and 51.27 in WebGPU. Overlap depth and residual motion were greater on WebGPU in both layouts. These measurements have no numerical pass threshold.

The same six clicks identified the isolated pin, the background, the gold link and the lilac endpoint. After one tick, the previous endpoint and part of the link cleared to the background. The point covered its link at its new location. Both packages returned the expected ID and RGBA at each probe. [Dense communities](#/production-forces?section=try-dense) · [Hub](#/production-forces?section=try-hubs)

SwiftShader passed the same nine layout checkpoints and every painted-color and click-ID probe. Its largest RMS position difference was 0.221% of the WebGL radius for dense communities at tick 100 and 0.404% for the hub at tick 99.

With one moving Graph on the M3, WebGPU's measured frame p95 stayed near 17.6 ms. WebGL control variability left relative frame speed unassessed on both graphs after a repeat. Click feedback met the declared margins in both run orders, and all 288 trusted clicks returned the intended pin or background. [M3 frame and click timings](#/production-forces?section=doc-scale-timing)
