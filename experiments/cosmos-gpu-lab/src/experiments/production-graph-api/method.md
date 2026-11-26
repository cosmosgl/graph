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
