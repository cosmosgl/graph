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

These figures describe one seeded cloud with repulsion enabled in isolation. The two packages use different hierarchical approximations. The [method](#/production-forces?section=doc-method) defines the spread and settling requirements.

## Native runtime at 8,192 slots

The same public application used one manual step, one paused draw and one awaited full position readback per sample. Visible Chrome ran a single Graph at a time on the M3. Each trial used a fresh graph, four warm-up updates and 24 timed updates at ticks 5 through 28.

| Trial | Median milliseconds per update | 95th percentile |
| --- | ---: | ---: |
| WebGL control, first | 12.9 | 14.4 |
| WebGPU | 1.5 | 1.8 |
| WebGL control, repeat | 12.7 | 17.8 |

The measurements include browser scheduling, GPU submission and position transfer. Rendering used a 288 × 192 canvas at pixel ratio 1.

## Dense communities and the movable hub

At tick 100, WebGPU placed the average point within 0.45% of the reference layout radius by the paired RMS measure. Both topologies preserved all 127 pins, the absent slot and all 8,182 ordered links at every checkpoint. Both retained the same fraction of each community. The table shows the native Apple M3 measurements. Distances are in graph units. [Layout checks and thresholds](#/production-forces?section=doc-scale-method)

| At tick 100 | Dense WebGL | Dense WebGPU | Hub WebGL | Hub WebGPU |
| --- | ---: | ---: | ---: | ---: |
| RMS radius | 3,216.80 | 3,217.31 | 3,225.84 | 3,228.54 |
| RMS motion during the last step | 0.446 | 0.701 | 0.569 | 1.008 |
| RMS spring-length error | 25.98 | 26.14 | 26.76 | 27.04 |
| Overlapping pairs | 13,797 | 13,210 | 15,121 | 16,711 |
| RMS penetration among overlapping pairs | 0.676 | 0.956 | 0.780 | 1.126 |

The largest paired RMS errors occurred at tick 100. Dense communities reached 7.08 units, or 0.220% of the WebGL radius. The hub reached 14.20 units, or 0.440%. The dense graph's largest source group contained 65 links. In the hub graph, free point 2 was the source of 1,023 links and the endpoint of one more. It moved 58.04 units in WebGL and 51.27 in WebGPU. Overlap depth and residual motion were greater on WebGPU in both layouts. These measurements have no numerical pass threshold.

The same six clicks identified the isolated pin, the background, the gold link and the lilac endpoint. After one tick, the previous endpoint and part of the link cleared to the background. The point covered its link at its new location. Both packages returned the expected ID and RGBA at each probe. [Dense communities](#/production-forces?section=try-dense) · [Hub](#/production-forces?section=try-hubs)
