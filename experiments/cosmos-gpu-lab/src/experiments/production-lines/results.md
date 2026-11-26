Solid straight links, moving endpoints, endpoint gradients, dashed strokes and fractional zoom matched every RGBA byte in the four-link fixture on Apple M3 and SwiftShader. Across all nine fixtures, **63 of 72 frame pairs matched exactly**. Only 50 of the 7,372,800 compared device pixels differed, each by one channel level.

Each cell lists differing device pixels **before / after** moving one endpoint. A 1× frame contains 40,960 pixels. A 2× frame contains 163,840. Chrome compared 36 frame pairs and 294 expected click targets on each adapter.

| Fixture | M3 at 1× | M3 at 2× | SwiftShader at 1× | SwiftShader at 2× |
| --- | ---: | ---: | ---: | ---: |
| Solid straight links | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Moving endpoint | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Solid curves | 6 / 6 | 6 / 25 | 2 / 0 | 0 / 0 |
| Endpoint gradients | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Dashed strokes | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Dotted strokes | 0 / 0 | 0 / 0 | 1 / 1 | 0 / 0 |
| Arrows | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 2 |
| Hover color and width | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 1 |
| Fractional zoom | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

All 588 click targets returned the expected ID in both packages. Every painted pixel was within one device pixel of the other package's silhouette. Every shared interior passed the two-level channel check.

A click two CSS pixels from the center of the horizontal stroke shows why the pixels and the callbacks need separate checks. The WebGL package returns link 0 there even though the background is visible. The earlier WebGPU package missed 28 clicks inside the padded target on each adapter. Both packages now return link 0 at that location, the later link at the crossing and point 8 over the path. Dash and dot gaps remain clickable.

The curve and patterned-stroke comparisons exercise individual features on opaque links with antialiasing. The zoom case uses a 1.25× camera scale. The tests also move the endpoint back in the moving case and check that each package reproduces its original image and click targets.

## Changing only link widths

On M3, changing 8,192 link widths in a graph with 4,096 points used to upload 393,216 bytes of point styles, 16,384 bytes of point draw order and 262,144 bytes of link records. The WebGPU Lines module now uploads 32,768 bytes of widths and patches the existing link records on the GPU. Point-style and draw-order uploads were zero for an immediate edit, an animated edit and a second edit that interrupted the animation. The interrupted edit also uploaded 32 bytes of transition parameters. These are CPU-to-GPU byte counts for the edit. An animation can also copy or interpolate its source on the GPU.

The packaged four-link comparison widens a horizontal stroke from 2 to 12 CSS pixels and restores it to 2. At pixel ratios 1 and 2, both packages paint the same canvas at all three widths. A click five CSS pixels off the centerline changes from background to link 0 and back to background. The point covering the link remains the foreground pick.

## Endpoint rounding beyond the four-link fixture

A separate SwiftShader sweep placed 30 vertical links in alternating directions near 1/16-device-pixel rounding ties. The solid case originally differed at 120 pixels at 1×. After the cap correction it matched exactly at both ratios. Styling those same links exposed further differences.

| Style | Differing pixels at 1× | Largest channel difference at 1× | Differing pixels at 2× |
| --- | ---: | ---: | ---: |
| Endpoint gradients | 49 | 1 | 1 |
| Dashed | 39 | 94 | 0 |
| Dotted | 61 | 16 | 0 |
| Arrows | 25 | 6 | 0 |

The single gradient difference at 2× was one channel level. Pattern and arrow coverage at these endpoints remain open comparisons.

## Dashed endpoints in motion

On Apple M3, both moving endpoints preserved every complete dash and every tested click target. The 1× dashed frame with the largest channel difference occurred at −1 device pixel. Six cap pixels differed, with a maximum difference of 95/255. Their silhouettes stayed within one device pixel. This motion check supports keeping the current renderer.

| Adapter | Stroke | Ratio | Exact forward frames out of 65 | Worst offset in device pixels | Differing pixels at that offset | Maximum channel difference |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Apple M3 | Dashed | 1× | 62 | −1 | 6 | 95 |
| Apple M3 | Dashed | 2× | 62 | −0.5 | 10 | 93 |
| Apple M3 | Solid | 1× | 62 | −1 | 6 | 186 |
| Apple M3 | Solid | 2× | 63 | −0.5 | 10 | 186 |
| SwiftShader | Dashed | 1× | 61 | +1/32 | 24 | 94 |
| SwiftShader | Dashed | 2× | 60 | +17/32 | 40 | 18 |
| SwiftShader | Solid | 1× | 65 | All exact | 0 | 0 |
| SwiftShader | Solid | 2× | 65 | All exact | 0 | 0 |

Each reverse sweep reproduced every forward frame within its engine. Across 520 frame pairs on each adapter, zero pixels exceeded the outline or interior allowances, every complete sampled dash and gap stayed intact, and the temporal check detected zero flashes. All 120 paired click probes per adapter returned the expected IDs. In the dashed case, both paint and gap returned link 0 on the downward stroke and link 1 on the upward stroke. The clear background probe returned background. The table ranks phases by maximum channel difference, then differing pixel count, then the earliest forward phase.
