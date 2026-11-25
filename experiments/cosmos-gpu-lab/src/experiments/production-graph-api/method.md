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

Open [Remove and restore a point](#/production-graph-api?section=try-sparse-transition) and choose a frame. Both packages start with three points. The replay removes point 1 by setting its position to NaN, leaves its link to point 0 in the data, then restores the same slot 32 CSS pixels to the right. Point 2 stays isolated. Each pane shows the captured canvas, and the table shows what each package returned for clicks on the edited point, its link and both surviving points.

The replay samples the start, midpoint and end of each one-second transition. The last two frames repeat removal and restoration with duration zero. Changing the pixel ratio reruns both packages. The browser test uses the same replay, compares every RGBA pixel and checks that the surviving points keep their coordinates and click IDs.

On M3, the original WebGPU removal differed from WebGL at 630 pixels halfway through the fade at 1× and 2,506 pixels at 2×. After the fix, all nine canvases at each ratio matched exactly. At the midpoint the outgoing point was 12 CSS pixels wide, the link was half as bright, and both clicks returned background. Halfway through restoration the center had moved 16 CSS pixels. A click at its destination, another 16 pixels away, already returned point 1 in both packages.

The unchanged **Add & Remove Points** story also exercises grow and fade, opacity, recolor and instant edits. On M3 the changing point’s interior matched at all 28 checkpoints at each ratio. Across the full story canvas, 17–25 pixels at 1× and 32–41 at 2× differed by one channel level. The initial frames already differed at 25 and 41 pixels respectively. A separate paired regression checks a newly appended point and link with explicit styles, including the story’s two-stage addition.

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
