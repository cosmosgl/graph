All eight shapes matched WebGL byte for byte in all eight Lab frames on Apple M3 in Chrome. The 802,560 pixels include the antialiased edges, the 22 CSS pixel control, and both integer centers and centers shifted 0.25 CSS pixels right and 0.375 down.

| Fractional diameter (CSS px) | Before at 1× | After at 1× (of 40,128) | Before at 2× | After at 2× (of 160,512) |
| ---: | ---: | ---: | ---: | ---: |
| 22.125 | 1 | 0 | 0 | 0 |
| 22.3 | 930 | 0 | 1,893 | 0 |
| 22.625 | 1 | 0 | 0 | 0 |
| 22.75 | 0 | 0 | 2 | 0 |

At 22.3 CSS pixels, WebGL's measured sprite-coordinate span was **22.25 device pixels at 1×** and **44.625 at 2×**. WebGPU previously used 22.3 and 44.6. All eight shapes use those coordinates to calculate edge opacity. The largest channel errors were 15 and 8 levels respectively. The other three diameters already had matching spans. They exposed four one-level differences from coordinate interpolation.

The WebGPU point shader now uses the measured origin and span on Apple GPUs. Each shape uses its requested diameter to calculate coverage. For the eight frames above, both the drawing buffers and the displayed canvases matched. Each WebGL frame also matched its saved pre-change pixels.

An additional placement check moved the centers 0.1 CSS pixels right and 0.4 down. On the M3 it found one differing pixel across the four 1× frames and 10–11 per frame at 2×. The largest difference was one channel level.
