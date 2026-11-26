The two panes run the same code inside separate frames. The real WebGL and WebGPU packages each create their own Graph, GPU device, canvas and input handlers. The fixed input, colors, gravity settings and pinned IDs are shared with **Examples → Get Started → Manual step** in Storybook.

For a tick-by-tick check of the collision force, compare both position arrays and rendered canvases in [ForceCollision in the Cosmos packages](#/production-force-collision).

Build both standalone packages before starting the Lab. These commands run from the repository root.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
pnpm --filter @cosmos.gl/gpu-lab dev
```

Open `#/production-graph-api`. Click the red point in each pane and check for point 0, then click the blue point and check for point 1. Press **Step gravity**. The pinned x coordinate should stay at 1984 while the free endpoint moves left from 2112. Reset reloads both packages. Each pane reports its own initialization or readback error.

This small case exercises pre-initialization setters, NaN absence, linking, pinning, public async reads and picking. The panes share the GPU, so use the separate matched runs to measure performance.

### Move a curved link across a point

The red point (ID 2) stays at (128, 80) CSS px. Both endpoints of green link 0 move downward together for one second. The arc passes through the point’s center at 500 ms, while the straight line between its endpoints is still 24 CSS px below it. A second run omits point 2 and keeps the link, endpoints, camera and clock identical. [Replay the crossing](#/production-graph-api?section=try-curved-link-crossing)

On M3 at 1× and 2×, both packages returned these colors and click IDs.

| Time | Point center (128, 80) | Same center with point 2 omitted | Beside the point (160, 83) |
| --- | --- | --- | --- |
| 0 ms, curve above | Red · point 2 | Black · background | Black · background |
| 500 ms, crossing | Red · point 2 | Green · link 0 | Green · link 0 |
| 1,000 ms, curve below | Red · point 2 | Black · background | Black · background |

Following the exposed curve with a click returned link 0 at all three times. An empty corner always returned background. Adding point 2 at the crossing turned 164 fully green device pixels red at 1× and 700 at 2×. Both packages draw points after links and give a point in the pointer’s search area priority over the link beneath it.

All 30 paired click results agreed. At 1×, 9, 9 and 10 of the 40,960 pixels differed between packages before, during and after the crossing. Each differed by one green-channel level. The same differences appeared with point 2 omitted. At 2×, all three frames and their controls matched every RGBA byte.

### Move the curve behind a point image

Point 2 carries a 96 × 96 CSS px image centered at (128, 80). Its horizontal red strip has opaque, half-alpha and transparent bands. The green curve crosses the strip at 500 ms. Both real packages produced these pixel colors and public click IDs on M3 at 1× and 2×. [Replay the image crossing](#/production-graph-api?section=try-curved-link-image-crossing)

| Probe (CSS px) | RGB before and after | RGB at the crossing | Click with point 2 present |
| --- | --- | --- | --- |
| Opaque (104, 82) | (255, 0, 0) | (255, 0, 0) | Point 2 |
| Half-alpha (128, 80) | (64, 0, 0) | (64, 127, 0) | Point 2 |
| Transparent (152, 82) | (0, 0, 0) | (0, 255, 0) | Point 2 |
| 46 CSS px right of center (174, 80) | (0, 0, 0) | (0, 0, 0) | Point 2 |

With point 2 omitted, all four clicks returned background at 0 and 1,000 ms and link 0 at 500 ms. At (174, 80) the link’s picking tolerance reaches a pixel just beyond the painted stroke. Adding the image point makes its circular click target take precedence even at a transparent texel. All 48 paired clicks agreed.

At 2× all 163,840 device pixels matched in each frame. At 1×, 9, 6 and 10 of the 40,960 pixels differed before, during and after the crossing, each by one green-channel level at a curve edge that also differed with the point omitted. Both packages painted the red strip from x = 80 to 144 and y = 68 to 92 CSS px (exclusive upper bounds).

WebGPU previously used the invisible shape’s fill color under the image and drew a requested 96 CSS px image at 64. An image-only point now starts with transparent black, and the atlas uses the same nearest-texel sampling as WebGL. The half-alpha red texel contributes about half its red in the shader and is blended with the background at half opacity. The separate opaque-image control measured the full requested widths of 48, 64, 80, 96 and 128 CSS px on both packages. At 96, a click 46 CSS px from center hit the point and a click 57 CSS px away returned background.

### Cross a dashed link over a solid link

A red dashed link crosses a green solid link at (128, 80) CSS px. Both are 8 CSS px wide. Moving the horizontal link 16 CSS px along its own path puts the same click in the middle of a dash or a gap. Swapping the two entries in `setLinks` also swaps their public IDs. [Replay the styled link crossing](#/production-graph-api?section=try-styled-link-crossing)

| Link order in the array | On a dash · pixel and click | In a gap · pixel and click |
| --- | --- | --- |
| Solid 0, then dashed 1 | Red · dashed link 1 | Green · dashed link 1 |
| Dashed 0, then solid 1 | Green · solid link 1 | Green · solid link 1 |

The gap lets the green stroke show through. Both packages pick along the full dashed path, so the last link in the array still receives the click at the crossing. With the dashed link alone, the gap was black and the click returned link 0.

All 16 paired canvases and all 80 paired click IDs and sampled colors matched on M3 at 1× and 2×, including the single-link controls. Reversing the links changed exactly the 8 × 8 CSS px overlap on a painted dash (64 device pixels at 1× and 256 at 2×). Reversing them in the gap changed zero pixels even though the click switched from the dashed link to the solid link.

### Remove and restore a point

The replay removes point 1 by setting its position to NaN, leaves its link to point 0 in the data, then restores the same slot 32 CSS pixels to the right. Point 2 stays isolated. Choose a frame to see each package’s canvas, click results and selected IDs. [Remove and restore a point](#/production-graph-api?section=try-sparse-transition)

At the first removal frame, the old rectangle and lasso already returned `[]` while the point still painted at its full 24 CSS px diameter. Both stayed empty through the fade. At the first restoration frame, both returned `[1]` at the old center (x = 48) while the point had no painted pixels. Halfway through, both tools returned `[1]` at the midpoint (x = 64) and `[]` at the destination (x = 80).

The destination rectangle and diamond lasso each span 4 × 4 CSS px. During the one-second restoration, both packages returned the following IDs there on M3 at 1× and 2×.

| Time after restoration starts | Destination rectangle | Destination lasso |
| --- | --- | --- |
| 521 ms | `[]` | `[]` |
| 522 ms | `[1]` | `[]` |
| 749 ms | `[1]` | `[]` |
| 750 ms through the sampled end at 1,000 ms | `[1]` | `[1]` |

The rectangle uses the point’s full 12 CSS px target radius and starts selecting as the moving center reaches x = 66. The lasso starts selecting when the center reaches its left vertex at x = 78. The times are specific to this geometry and the default cubic easing. A region containing all three locations returned `[0, 2]` throughout removal and `[0, 1, 2]` from the start of restoration. The replay also checks removal and restoration with duration zero. Across 14 checkpoints at both ratios, all 224 pairs of ID lists and all 28 pairs of rendered frames matched.

On M3, the original WebGPU removal differed from WebGL at 630 pixels halfway through the fade at 1× and 2,506 pixels at 2×. After the fix, all nine canvases at each ratio matched exactly. At the midpoint the outgoing point was 12 CSS pixels wide, the link was half as bright, and both clicks returned background. Halfway through restoration the center had moved 16 CSS pixels. A click at its destination, another 16 pixels away, already returned point 1 in both packages.

The unchanged **Add & Remove Points** story also exercises grow and fade, opacity, recolor and instant edits. On M3 the changing point’s interior matched at all 28 checkpoints at each ratio. Across the full story canvas, 17–25 pixels at 1× and 32–41 at 2× differed by one channel level. The initial frames already differed at 25 and 41 pixels respectively. A separate paired regression checks a newly appended point and link with explicit styles, including the story’s two-stage addition.

### Restore a point halfway through removal

The replay restores point 1 at x = 80 exactly 500 ms into its one-second removal at x = 48. The next frame uses the same clock time. Before the edit, both packages still paint a 12 CSS px point at the old center and the link’s green channel is 128/255. Immediately after the edit, the point and link disappear. The new fade starts from the slot’s previous absent state, and its center starts travelling from x = 48. [Compare the frames on either side of the edit](#/production-graph-api?section=try-interrupted-removal)

Each endpoint has a click probe, a 4 × 4 CSS px rectangle and a diamond lasso of the same width and height. In the table, each area cell gives the rectangle result first and the lasso result second. These IDs agreed on M3 at 1× and 2×.

| Frame | Old click | New click | Old rectangle / lasso | New rectangle / lasso |
| --- | --- | --- | --- | --- |
| Just before restoration | Background | Background | `[] / []` | `[] / []` |
| First restoration frame | Point 1 | Background | `[1] / [1]` | `[] / []` |
| 16 ms into restoration | Point 1 | Link 0 | `[1] / [1]` | `[] / []` |
| 250 ms | Point 1 | Link 0 | `[1] / []` | `[] / []` |
| 500 ms | Point 1 | Point 1 | `[] / []` | `[] / []` |
| 522 ms | Point 1 | Point 1 | `[] / []` | `[1] / []` |
| 750 ms | Background | Point 1 | `[] / []` | `[1] / [1]` |
| 1,000 ms | Background | Point 1 | `[] / []` | `[1] / [1]` |

At 16 ms, the link runs beneath the new position and its green channel still rounds to zero there. At 500 ms, the painted point is 12 CSS px wide at x = 64. The click search window at either endpoint can reach point 1. Only the midpoint’s small rectangle and lasso select it. At the destination, the rectangle first returns `[1]` at 522 ms and the lasso at 750 ms. Each was empty one millisecond earlier. At 1,000 ms, the point is 24 CSS px wide at x = 80 and the link is fully bright. All 26 frame pairs matched pixel for pixel.

### Remove the point again halfway through restoration

Point 1 starts at x = 48, begins returning toward x = 80 halfway through its first removal, and is removed again when it reaches x = 64. The replay samples the frame before and after that second removal at the same clock time. At each position it clicks the center and queries a 4 × 4 CSS px rectangle and diamond lasso. [Compare the second removal](#/production-graph-api?section=try-remove-again)

| Frame | Painted point at the midpoint | Link green channel | Clicks at old / midpoint / new | Rectangle IDs at old / midpoint / new | Lasso IDs at old / midpoint / new |
| --- | --- | ---: | --- | --- | --- |
| Just before second removal | 12 CSS px wide | 128/255 | Point 1 / Point 1 / Point 1 | `[] / [1] / []` | `[] / [1] / []` |
| First frame after second removal | 24 CSS px wide | 255/255 | Background at all three | `[] / [] / []` | `[] / [] / []` |
| 500 ms into the second fade | 12 CSS px wide | 128/255 | Background at all three | `[] / [] / []` | `[] / [] / []` |
| 1,000 ms into the second fade | No visible pixels | 0/255 | Background at all three | `[] / [] / []` | `[] / [] / []` |

Before the edit, the click search window at each endpoint could reach the returning point 16 CSS px away. The small area probes selected it only at the midpoint. The second removal froze its current position and started the outgoing fade from fully present, because the previous edit had restored the slot. Clicks and area queries saw the new absence flag immediately. The whole-graph rectangle and lasso returned `[0, 2]` through the second fade.

The frames halfway through restoration and halfway through the second fade matched byte for byte within each package, even though all three click results changed. Across packages, all 26 frame pairs matched pixel for pixel on M3 at 1× and 2×.

### Restore the original position during the second fade

At 500 ms into its second removal, point 1 is 12 CSS px wide at x = 64 and its link’s green channel is 128/255. Submitting x = 48 as the destination at that same clock time makes the slot present again. The new fade starts fully transparent at the midpoint. Both packages draw zero pixels for the point and link on that frame, yet clicks at all three sites reach point 1. [Replay the return to the original center](#/production-graph-api?section=try-restore-original)

The click column lists the results at x = 48, 64 and 80 in that order. The last two columns list the centers whose 4 × 4 CSS px rectangle or diamond lasso returned `[1]`. Every other local region returned `[]`.

| Time from final restoration | Clicks at original / midpoint / first target | Rectangle centers selecting point 1 | Lasso centers selecting point 1 |
| --- | --- | --- | --- |
| Just before the edit | Background / Background / Background | None | None |
| 0 ms | Point 1 / Point 1 / Point 1 | 64 | 64 |
| 315 ms | Point 1 / Point 1 / Point 1 | 48, 64 | None |
| 359 ms | Point 1 / Point 1 / Link 0 | 48, 64 | None |
| 500 ms | Point 1 / Point 1 / Link 0 | 48, 64 | None |
| 686 ms | Point 1 / Point 1 / Link 0 | 48 | 48 |
| 1,000 ms | Point 1 / Point 1 / Link 0 | 48 | 48 |

The point travels 16 CSS px left with the default cubic easing. Rectangles use the 12 CSS px target radius and lassos use the moving center. The click at x = 80 changes to the underlying link when the point leaves its picking window. Each of the three switches above was checked one millisecond earlier as well. At 500 ms the paint is 12 CSS px wide at x = 56, with link green back at 128/255. At 1,000 ms the 24 CSS px point and its link exactly reproduce the initial canvas and hit results in each package. All 46 paired frames matched pixel for pixel on M3 at 1× and 2×.

### Remove the point halfway back

The replay removes point 1 for the third time at x = 56, 500 ms into its return to x = 48. On M3 at 1× and 2×, both packages held the center at x = 56 and restarted the fade at full size. At the same clock time, the painted diameter changed from 12 to 24 CSS px and the link’s green channel went from 128 to 255. [Compare the third removal](#/production-graph-api?section=try-remove-on-return)

The four probes share y = 96. Each uses a click, a 4 × 4 CSS px rectangle and a diamond lasso of the same width and height. The RGB values are the actual canvas pixel at each probe.

| x (CSS px) | RGB before → after the edit | Click before | Rectangle before | Lasso before |
| ---: | --- | --- | --- | --- |
| 48 | (0, 0, 0) → (255, 0, 0) | Point 1 | `[1]` | `[]` |
| 56 | (64, 64, 0) → (255, 0, 0) | Point 1 | `[1]` | `[1]` |
| 64 | (0, 128, 0) → (255, 0, 0) | Point 1 | `[1]` | `[]` |
| 80 | (0, 128, 0) → (0, 255, 0) | Link 0 | `[]` | `[]` |

Immediately after removal, every click returned Background and every local area returned `[]`. The whole-graph rectangle and lasso retained `[0, 2]`. At 500 ms into the third fade, the entire canvas again matched the frame just before the edit, while point 1 and link 0 remained unavailable to all four probes. At 1,000 ms, both had disappeared. All 50 frame pairs matched pixel for pixel across packages.

### Restore to x = 80 during the third fade

At 500 ms into the third fade, point 1 was still 12 CSS px wide at x = 56 and its link’s green channel was 128. All four clicks returned background and all local selections were empty. Restoring point 1 to x = 80 at that same instant cleared the point and link from the canvas. Clicks at x = 48, 56 and 64 immediately returned point 1. Both whole-graph selections changed from `[0, 2]` to `[0, 1, 2]`. [Replay the restoration to x = 80](#/production-graph-api?section=try-restore-to-80)

The four probes share y = 96. Each rectangle and diamond lasso spans 4 × 4 CSS px. Times below are inclusive milliseconds after the restore, with adjacent whole milliseconds sampled at every handoff. Outside the listed selection windows the local result was `[]`.

| Probe x | Click | Rectangle returns `[1]` | Lasso returns `[1]` |
| ---: | --- | --- | --- |
| 48 | Point 1 through 513 ms, then background | 0–396 ms | Never |
| 56 | Point 1 through 683 ms, then background | 0–529 ms | 0–275 ms |
| 64 | Point 1 throughout | 0–724 ms | 397–470 ms |
| 80 | Background at 0–1 ms, link 0 at 2–374 ms, point 1 from 375 ms | 471–1,000 ms | 725–1,000 ms |

At x = 80 the first link hit arrived while the pixel still read black. Halfway through the restore, the point was 12 CSS px wide at x = 68 and the link’s green channel was 128. At 1,000 ms the point was 24 CSS px wide at x = 80, the green channel was 255 and the full canvas matched the settled x = 80 frame after an uninterrupted restoration. Across 1× and 2× on M3, all 94 frame pairs, 376 site clicks and 940 rectangle and lasso results agreed between packages.

### Remove point 1 at x = 68 on its way to x = 80

At 500 ms into the return to x = 80, point 1 was 12 CSS px wide at x = 68. Removing it on that clock tick kept the center in place, restarted the fade at 24 CSS px and brought the link’s green channel from 128 to 255. All five clicks switched from point 1 to background, including the click at x = 80 over the bright green link. [Replay the fourth removal](#/production-graph-api?section=try-remove-at-68)

The probes share y = 96. Each rectangle and diamond lasso spans 4 × 4 CSS px. All ten local area queries returned `[]` from the first removal frame through the end of the fade.

| Probe x | RGB before removal | RGB on removal | Rectangle before | Lasso before |
| ---: | --- | --- | --- | --- |
| 48 | (0, 0, 0) | (0, 0, 0) | `[]` | `[]` |
| 56 | (0, 0, 0) | (255, 0, 0) | `[1]` | `[]` |
| 64 | (64, 0, 0) | (255, 0, 0) | `[1]` | `[]` |
| 68 | (64, 64, 0) | (255, 0, 0) | `[1]` | `[1]` |
| 80 | (0, 128, 0) | (0, 255, 0) | `[1]` | `[]` |

Halfway through removal, both packages reproduced every pixel of the pre-removal canvas. The point and its link still returned background, and both whole-graph selections retained `[0, 2]`. At 750 ms, the remaining point covered 2 CSS px horizontally at 1× and 1 CSS px at 2×. By 1,000 ms, both the point and the link had disappeared. WebGL and WebGPU agreed at each pixel ratio on all 86 frame pairs, 430 site clicks and 1,032 local and whole-graph rectangle and lasso results.

### Hover under a stationary cursor

Open the [stationary hover replay](#/production-graph-api?section=try-stationary-hover). The application parks the cursor over empty space, moves point 0 underneath it, holds it there, then replaces it with point 1. It moves point 1 away and zooms the camera to bring the point back beneath the cursor. The last checkpoint takes the pointer off the canvas. Choose a checkpoint to compare the green ring and the sequence of callbacks at either pixel ratio.

WebGL reports `over 0` when point 0 arrives. Holding the same point produces no further event. A direct handoff to point 1 reports `over 1`, and moving it away reports `out 1`. Across all nine checkpoints the application receives exactly one mouse-move callback. A separate WebGPU regression holds a real GPU pick while points change, then checks the latest point, a gravity step and a pointer that leaves before a read finishes.

On M3, the original candidate missed all seven hover callbacks at each pixel ratio. Refreshing the pick recovered the callbacks, but the ring still appeared wider and brighter. WebGL draws hover and focus over the point sprites and gives the hover ring 70% opacity. With that drawing rule, both packages matched every RGBA byte in all nine paired frames at 1× and all nine at 2×.

### Change only point colors and sizes

Open [Change only point colors and sizes](#/production-graph-api?section=try-point-style-updates). The upper link blends its two endpoint colors. Recolor point 0 from red to blue and the midpoint changes from yellow-green to blue-green, even though the link record stays the same. The lower link and its points serve as controls.

Both packages receive the same edits to the same reused arrays. The replay reads the canvas at eight checkpoints, measures the drawn diameter and clicks five locations per frame. Choose **Interrupt with a larger white point** to see how the next transition starts. Halfway from 40 to 8 CSS pixels the point is 24 pixels wide. WebGL restarts at its old 8-pixel target. WebGPU continues from the displayed 24 pixels.

The two edge probes are 20 and 22 CSS pixels below point 0’s center. The standalone pointer searches a 9×9 window in a half-resolution pick buffer, so a click can hit just outside the painted circle. WebGPU uses the diameter from the last drawn frame. On M3, the following IDs were the same at 1× and 2×.

| Checkpoint | WebGPU displayed diameter | WebGPU at 20 px | WebGPU at 22 px | WebGL at 20 / 22 px |
| --- | ---: | --- | --- | --- |
| Just before interruption | 24 px | Point 0 | Background | Point 2 / Point 2 |
| First frame after interruption | 24 px | Point 0 | Background | Point 2 / Point 2 |
| Halfway through regrowth | 32 px | Point 0 | Point 0 | Point 2 / Point 2 |

WebGL holds its last hit throughout a size transition. Here, point 2 was the last control clicked before the animation. The old WebGPU build missed both edge probes just before the restart, then hit both as soon as it received the larger target. Fixing the pointer changed eight edge-click results across both ratios. All 32 package frame captures kept their previous RGBA hashes.

At the same checkpoints, the replay queries a rectangle and a trapezoidal lasso. Each extends down to include point 2. Their top edges start 10, 14 or 18 CSS pixels below point 0’s center. Both packages returned these exact ordered IDs at both pixel ratios.

| Checkpoint | Painted diameter, WebGL / WebGPU | Target diameter | Rectangle at all three offsets | Lasso at all three offsets |
| --- | --- | --- | --- | --- |
| Just before interruption | 24 / 24 px | 8 px | `[2]` | `[2]` |
| First frame after interruption | 8 / 24 px | 40 px | `[0, 2]` | `[2]` |
| Halfway through regrowth | 24 / 32 px | 40 px | `[0, 2]` | `[2]` |

The rectangle expands its bounds by half the target diameter. At 10 px it can miss a point whose paint reaches into the rectangle. When the target grows, it can select the point before the paint reaches 18 px. The lasso checks the center. Moving the top edge 8 px above the center gave `[0, 2]` for both tools at every checkpoint. All 128 paired results matched across eight checkpoints, four offsets, two tools and two pixel ratios.

Across packages, five of eight M3 frames matched every RGBA byte at each pixel ratio. Halfway through shrinking, 16 pixels at 1× and 32 at 2× differed by one channel level. The other two frames show the different restart sizes and colors. The endpoint gradient and the control link matched throughout. The regrowth midpoint also exercises a 32-pixel circle at a tile boundary. [Tile-origin control](#/production-points?section=doc-results)

On the 4,096-point, 8,192-link WebGPU fixture, each of the four point edits previously uploaded 262,144 bytes of link records and 16,384 bytes of point draw order. Immediate color, immediate size, animated color and size, and interrupted color and size now upload zero bytes to either buffer. Color-only point data used 81,928 bytes, size-only used 49,160, and combined edits used 131,080. A restarted point transition also uploaded 32 bytes of interpolation parameters.

### Two headless point trackers

Open [Two headless point trackers](#/production-graph-api?section=try-headless-trackers). Each package creates a `GraphSimulation` and two trackers before the device or data is ready. A and B both follow point 1. When A changes its indices, its old request resolves to `null`. B's pending request still returns point 1 at the coordinate it had when the request began.

```ts
const a = simulation.trackPoints([3, 1, 0])
const b = simulation.trackPoints([1, 4, 5])
// After supplying data and stepping the simulation:
a.setIndices([2, 1, 2, 6])
a.destroy()
const positions = await b.positionsAsync?.()
```

Choose **Destroy A and step B** to see point 1 move from x = 2140 to x ≈ 2130.8 in the surviving tracker. Both real packages matched every ID and float32 coordinate at all six M3 checkpoints. The test also checks the read against the full simulation positions. Duplicate indices occupy separate slots in the ordered array, and absent points leave a pair of `NaN` values.

Use `await tracker.positionsAsync()` when a label needs positions from a particular tick. WebGPU's synchronous `positions()` and `positionsArray()` return the latest completed copy and start a read when newer positions are available.

### Moving YouTube graph

The paired M3 replay uses both built packages and reports readback, highlight updates and label redraw separately. [Moving YouTube selection and labels](#/production-graph-api?section=doc-youtube-selection)

Prepare the SNAP YouTube fixture as described in the Lab README, then run the replay from the repository root.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs
```

### Earlier WebGPU-only replay

The earlier replay opened visible Chrome and ran the built WebGPU Graph at 65,536 and 1,000,000 points on the induced YouTube topology. Each run used a fixed camera, the four recorded drag rectangles and 1,000 tracked labels. A separate input overlay kept the camera still while the pointer dragged.

For correctness, the release handler submits rectangle selection, label gathering and a full position copy in the same task. An independent CSS-space rectangle calculation checks the ordered point IDs against that position snapshot. Each tracked label coordinate must equal the corresponding snapshot coordinate. The timing run omits the full copy and the oracle. It measures from handler entry to the ID result, then to the second animation-frame callback after applying highlights, updating the count, showing the box and drawing the labels. That callback gives the browser an opportunity to paint. The actual time the display presents the frame can differ.

The historical capture includes the tested bundle, source snapshot, browser and device identity, raw samples and screenshots. It provides a single-engine baseline.

Chrome 157.0.8103.79 reported an Apple Metal 3 WebGPU adapter on the M3. Both graph sizes completed four correctness drags. All eight ordered ID lists matched the release-time reference, and all 1,000 tracked coordinates matched on every release. On the million-point graph the four rectangles selected 425,378, 4,568, 56,254 and 5,717 IDs in the correctness run.

| Moving points | Links | Time to IDs | Time to feedback opportunity |
| ---: | ---: | ---: | ---: |
| 65,536 | 432,898 | 169–290 ms | 254–427 ms |
| 1,000,000 | 2,852,734 | 989–4,369 ms | 2,003–6,047 ms |

Each range covers the four releases of one timing run at 961 × 541 CSS pixels, device pixel ratio 2 and zoom 0.25. The fixed-camera capture is `captures/public-graph-youtube-dWq8Uu/result.json`. Its tested bundle SHA-256 is `86cd64eb4c0a02bc54d14802c48a34d49b1b89ccfb042398d3dd285f4849b56a`. An earlier harness also panned the camera during a drag. The figures above come exclusively from the replay that verifies the camera center at every release.

Other repository checks were running on the same machine during this historical replay. The paired replay above adds WebGL controls and separates readback from the two UI updates.
