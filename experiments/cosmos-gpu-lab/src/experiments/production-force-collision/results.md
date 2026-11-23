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
