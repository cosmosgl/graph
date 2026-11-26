All eight shapes matched WebGL in all 26 Points frames on **Apple M3 (Metal)** and all 26 on **SwiftShader** in Chrome 157.0.8103.79. Across the two adapters, every RGBA channel matched in 5,216,640 compared pixels.

A later M3 replay caught a 32 CSS-pixel circle that drew as a square when its sprite started on a raster tile boundary. For the aligned axis, the coordinate at the tile origin is exactly zero. Using that value avoids dividing by a rounding step that Metal can flush to zero. A static control places four circles on both axes, one axis or neither. It went from 804 differing pixels at 1× and 1,722 at 2× to exact agreement at both ratios. [Interrupted point-style replay](#/production-graph-api?section=try-point-style-updates)

| Center placement | Diameters in CSS pixels | M3 at 1× | M3 at 2× | SwiftShader at 1× | SwiftShader at 2× |
| --- | --- | ---: | ---: | ---: | ---: |
| (0.25, 0.375) CSS px | 22.125, 22.3, 22.625, 22.75 | 0 | 0 | 0 | 0 |
| (0.1, 0.4) CSS px | 22.125, 22.3, 22.625, 22.75 | 0 | 0 | 0 | 0 |
| 1/32-device-pixel ties | 22.125, 22.3, 22.625, 22.75 | 0 | 0 | 0 | 0 |
| 1/32-device-pixel ties | Alternating 24 / 22 control | 0 | 0 | 0 | 0 |

Each number counts differing device pixels across the frames in that row. A 1× frame contains 40,128 pixels, and a 2× frame contains 160,512. The two CSS-offset presets also include unshifted centers and a 22 px size control. Each WebGL capture agreed with its saved pre-change frame on the same adapter.

## What changed at shifted centers

At the (0.1, 0.4) offset, the previous M3 renderer differed from WebGL at 1 pixel across the four 1× frames and 43 pixels across the four 2× frames. Every difference was one channel level. Interpolation across a WebGPU quad can give a slightly different coordinate at an edge than a WebGL point sprite. The point shader now evaluates that coordinate relative to a 32-device-pixel tile using the measured precision of the M3 rasterizer. All eight shapes share the calculation.

On SwiftShader, the original 24 / 22 tie scene differed at 165 pixels at 1× and 202 at 2×. The four fractional diameters exposed 670 and 790 differing pixels respectively. A projected center halfway between grid positions could round to a different 1/16-device-pixel location. SwiftShader also rounds each projected corner independently. The WebGPU renderer now uses the shared camera projection and applies both rounding steps before evaluating coverage.

Both ForceCollision cases matched in positions and pixels at ticks 0 through 8 on each adapter. The Points comparisons use opaque fills and a fixed camera. Two additional M3 checks with other sizes and offsets found eight differing pixels across 24 frames and two across 42 small-point frames. Each differed by one channel level.

## Earlier diameter comparison

| Fractional diameter (CSS px) | Before at 1× | After at 1× (of 40,128) | Before at 2× | After at 2× (of 160,512) |
| ---: | ---: | ---: | ---: | ---: |
| 22.125 | 1 | 0 | 0 | 0 |
| 22.3 | 930 | 0 | 1,893 | 0 |
| 22.625 | 1 | 0 | 0 | 0 |
| 22.75 | 0 | 0 | 2 | 0 |

At 22.3 CSS pixels, WebGL's measured sprite-coordinate span was **22.25 device pixels at 1×** and **44.625 at 2×**. WebGPU previously used 22.3 and 44.6. All eight shapes use those coordinates to calculate edge opacity. The largest channel errors were 15 and 8 levels respectively. The other three diameters already had matching spans. They exposed four one-level differences from coordinate interpolation.

The first correction used the measured origin and span on Apple GPUs. Each shape used its requested diameter to calculate coverage. For the eight frames above, both the drawing buffers and the displayed canvases matched. Each WebGL frame also matched its saved pre-change pixels.

The same eight frames also matched on Chromium's SwiftShader software adapter. There, the renderer uses the nominal sprite diameter and samples it relative to a center on a 1/16-device-pixel grid. Both ForceCollision fixtures retained exact positions and pixels through eight steps on each adapter.

## Point-only occlusion

The stock performance story draws 200,000 circles in twelve seeded clusters. The simulation is paused and there are no links. On a 720 × 480 canvas at 1× on Apple M3, the WebGL reference (`74a216a7`) drew opaque cores front-to-back into depth, then painted translucent points and antialiased edges. The previous WebGPU standalone (`b52a9c7f`) used one blended point draw with the toggle in either position. It could use opaque point coverage to skip work on dense links.

WebGPU now uses two point draws for sufficiently overlapping sprites on its own canvas. The first paints only fully opaque samples, giving points later in the public draw order a nearer depth. The second blends in the original order and the depth test rejects samples already hidden by an opaque point. The probe compared all 345,600 RGBA pixels with culling on, off and back on. Both the opaque preset and the preset with 30% translucent points matched the previous WebGPU framebuffer byte-for-byte. WebGL's own on/off frames also matched exactly. Across engines, 29 pixels in the opaque scene and 19 in the mixed scene differed by one channel level out of 255.

| Completed draw on M3 | Opaque, culling on / off | Mixed, culling on / off |
| --- | --- | --- |
| WebGL reference | 4.55–5.10 / 29.05–29.30 ms | 3.70–5.20 / 28.05–29.00 ms |
| Previous WebGPU | 44.75–44.95 / 44.00–45.40 ms | 44.55–47.50 / 44.20–44.85 ms |
| WebGPU with ranked depth | 7.65–8.30 / 50.40–51.45 ms | 7.15–8.20 / 46.25–46.65 ms |

Each range spans two independent process medians. The host requested and waited for one complete frame at a time, with three warmups and five timed draws per state, twice per process. Reversing engine, alpha and toggle order kept the improvement visible in both runs. These are completed-draw measurements with the stock data and camera. The story normally runs its own animation loop.

A separate 1–16 px diameter sweep showed why the renderer keeps one draw for small points. At 7 px the estimated sprite area was 28 times the backing-canvas area and the advantage was marginal. At 9 px it was 47 times and the ranked passes saved at least 2.3 ms in each order. The renderer enables this path at 40 times the canvas area. Its estimate samples up to 64 point sizes and colors when styles change. Picking, highlighted point groups and host-owned depth retain their existing draws. The stock story replay, exact package bytes, per-frame results and diameter sweep are recorded in `captures/signed-point-occlusion-20261126/`.
