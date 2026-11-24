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

## Endpoint rounding beyond the four-link fixture

A separate SwiftShader sweep placed 30 vertical links in alternating directions near 1/16-device-pixel rounding ties. The solid case originally differed at 120 pixels at 1×. After the cap correction it matched exactly at both ratios. Styling those same links exposed further differences.

| Style | Differing pixels at 1× | Largest channel difference at 1× | Differing pixels at 2× |
| --- | ---: | ---: | ---: |
| Endpoint gradients | 49 | 1 | 1 |
| Dashed | 39 | 94 | 0 |
| Dotted | 61 | 16 | 0 |
| Arrows | 25 | 6 | 0 |

The single gradient difference at 2× was one channel level. Pattern and arrow coverage at these endpoints remain open comparisons.
