On Apple M3 in Chrome, the WebGL and WebGPU packages returned identical position buffers and drew identical canvases at every tick from 0 through 8. This held for both the seven-slot all-pairs case and the 4,097-slot hashed case. Reset reproduced the initial image and the first step.

### Why the first step exposed the circle edges

The circles start at integer pixel coordinates. The first collision step moves four of their centers between pixels. WebGL draws each plain circle inside a square the size of its diameter. The earlier WebGPU shader added a device pixel on each side of that square. On the first step it painted 33 partially covered pixels where WebGL drew background. All graph coordinates already agreed.

Matching the square alone left two differences in how the shaders evaluated positions inside it. At tick 3, one center landed halfway between adjacent steps of the reference rasterizer’s 1/256-device-pixel grid. At tick 6, the calculation of a circle-edge pixel’s opacity put one red channel on the other side of a rounding boundary. WebGPU now applies the reference center rounding for drawing, covers the same pixel centers as the point sprite, and interpolates normalized sprite coordinates before computing circle coverage.

| Tick | Differing pixels before | Differing pixels after |
| ---: | ---: | ---: |
| 0 | 0 | 0 |
| 1 | 33 | 0 |
| 2 | 35 | 0 |
| 3 | 101 | 0 |
| 4 | 42 | 0 |
| 5 | 42 | 0 |
| 6 | 44 | 0 |
| 7 | 40 | 0 |
| 8 | 36 | 0 |

The counts apply to both fixtures. Each frame contains 49,152 RGBA pixels at pixel ratio 1. A separate half-pixel-centered circle check confirms that, when a pixel center lies exactly on a sprite boundary, both packages include the left and bottom samples and exclude the top and right samples.

These measurements cover one contact group of integer-diameter circles at a fixed zoom on the tested GPU. The hashed case also checks every position in the offscreen grid.

### Collision grid sizing

Give all 4,097 points an explicit diameter of 2, leave the collision radius automatic and set padding to zero. Raising `pointDefaultSize` from 2 to 20 keeps every point's contact radius at 1 on both engines. WebGL includes the default in the maximum used to size its collision grid, so the cells grow from 8 to 20 graph units. WebGPU uses the largest resolved diameter, so its cells stay at 8. A missing or `NaN` size on a present point resolves to the default and counts toward that maximum.

We keep the WebGPU rule because changing an unused fallback should preserve the layout. A larger cell can put more neighbors in competition for the same sample slots and change which contacts the solver resolves.

On M3 we compared one collision-only step with seed 3, strength and friction 1, and 4,097 points in 64 columns spaced 1.25 graph units apart starting at (2,048, 2,048). The packages returned identical positions with default 2. Changing the default to 20 changed 3,701 point positions on WebGL and zero on WebGPU. The WebGPU regression also checks that when one point uses the larger default, its increased radius brings a previously separated pair into contact.

These sizes govern collision in graph space. The current WebGPU renderer draws points as quads and caps their screen diameter at 64 CSS pixels. Raising that cap is a separate rendering decision that calls for checking large-point paint, picking, rectangle selection and frame cost.
