# Selection and tracked labels on a live WebGPU graph

An area selection needs the point IDs for the view when the user makes the
request. A moving label can use the last completed coordinates. Its point must
disappear from the current label result as soon as it is removed.

## Proposed caller contract

Keep the synchronous rectangle, polygon and tracker APIs on the WebGL backend.
For new calls that work across backends, add promise-based rectangle and polygon
methods and an explicit async tracked-position snapshot. A WebGPU area request
captures the camera, point sizes and submitted GPU positions before it returns
its promise. The result is ordered by point ID. Two requests can complete
independently even after pan, zoom or a later simulation tick. A pending request
returns `null` if the graph or its point membership changes before completion.
Callers should discard a pending result when the user starts a newer selection
gesture.

Expose the latest completed tracked positions synchronously. The first read can
be empty. The map follows the requested order and omits missing IDs. The array
keeps a `NaN` pair for each absent or out-of-range ID and repeats duplicate
positions in their original slots. Tracking follows indices across shrink and
regrowth. Replacing the graph or the tracked list clears the old coordinates.
Removing a point filters the current map and array immediately. A newly present
point waits for a fresh gather. Discard copies from an older graph, point set or
tracked list.

The deck.gl hub labels can use this cache on each tick. After pause or settle,
they can await the fresh snapshot and refresh if the graph and label request
are still current. The existing synchronous getter can block on a cold cache
or when the caller requires the current position. WebGPU callers that need
current positions await that read, including the first read and the read after
pausing. Keep WebGL available during that caller migration.

## What we compare

Create the same Lab runtime used by the live viewer with `{ readback: true }`.
Its area queries reuse the tested selection shader on the resident positions
and style buffers. Coordinates are measured from the top-left of the canvas in
CSS pixels, including when the canvas displays at a different size than its
logical viewport. The tested rectangle rule uses the resolved point size and
the tested polygon rule uses centers.

On a chain of 8,192 points, display a 384 × 240 logical viewport at 256 × 160 CSS
pixels with device-pixel ratio 2. Compare exact area IDs against the CPU area
reference using separately read GPU positions and the corresponding view and
styles. Include paused overlapping requests with style/camera changes and eight
moving frames with alternating rectangles and polygons. Check that 97 requested
label slots match the exact positions at the recorded tick, that cache revisions
are ordered, and that a fresh read after pausing matches the final tick. Record
request wall time and copied bytes. The test also waits for reference readbacks
on each tick, so these are request timings only.

On a 257-point chain, test missing, pinned, duplicate and invalid IDs. Compare
fresh overlapping snapshots across motion. Invalidate pending results after
removal, list replacement, graph replacement and destruction. Verify immediate
cached removal and the return of index 256 when a graph shrunk to 32 regrows to
257. Require exact ID and coordinate order and no device validation errors.

Each selection request copies and examines four bytes per point, about 4 MB at
one million points. The tracker reads eight bytes per requested ID, and at most
one automatic gather is in flight. Its scheduling and allocation costs at high
tracking counts, production setters and transitions, pointer lasso wiring,
label presentation latency and million-point selection cost still need study.

## M3 result

The ten area requests returned the exact ordered IDs in visible Chrome 157 on
native Apple Metal 3 WebGPU with luma.gl 10.0.0-alpha.15. At 8,192 points each
request read 32,768 bytes of selection flags. Observed request wall time ranged
from 0.8 to 4.2 ms. The eight sampled label caches and a fresh read after pause
matched the exact positions at their recorded tick. A 97-ID gather read 776
bytes and returned 93 distinct live IDs. These checks included synchronous
reads of the label cache while the layout ran.

All checks passed with zero recorded device validation errors. The cache still
returned the previous coordinates immediately after a coordinate-only write.
Removal filtered both slots of a duplicated ID, a new gather restored that ID
at its new coordinates, and old requests were discarded across removal, index
changes, graph replacement and destruction. The older 19-query area and
eight-request tracker baselines also passed, along with six viewer tests. Capture
`captures/viewer-readback-m3-mwnhy81t/` used base revision
`5a211b939887d3717c00cbddbb2543ccdba8b1b2` and source archive SHA-256
`fa93936123720b58bd38f43dc630cc75560c1814c83c265f8efa9d6e7ef22ce3`.
The first passing capture `captures/viewer-readback-m3-mwnhu6ju/` recorded
the backing dimensions before resize. The replay records the dimensions used
for the requests, 768 × 480 backing pixels.

## Actual Graph selection and labels

The production Graph exposes asynchronous rectangle and polygon selection
and tracked-coordinate reads. The Actions, Lasso selection and Labels stories
use them. Selection uses the same geometry as the synchronous methods. Each
request copies the GPU result before yielding and drops it when a setter
replaces its point or link data. Label drawing coalesces pending requests.

The native benchmark uses the built production Graph and the Storybook label
renderer. Compare 16,384 points moving under gravity and a paused million-point
scatter at 640 × 400 CSS pixels and DPR 2. Alternate rectangles and concave
polygons, show the selection highlights and draw the 1,000 requested labels.
Record GPU query and highlight feedback times separately, along with gather
and label presentation times. Compare all IDs and coordinates to the existing
Graph methods outside the timed intervals. Replace topology, shrink and regrow
the point set while checking that pending requests are discarded and the tracked
indices appear again when they exist. Record startup and sampled GPU allocation.

The verified native M3 run returned exact IDs and coordinates in both lanes.
The requests issued before point and topology replacement resolved to `null`.
The tracked set appeared again after regrowth. The moving lane completed 16
simulation ticks while the selections and overlays were exercised.

| Graph | Selection read median / max | Selection with highlight max | Label gather median / max | Label presentation max |
| --- | ---: | ---: | ---: | ---: |
| 16,384 moving | 14.0 / 21.4 ms | 45.3 ms | 14.0 / 18.9 ms | 32.6 ms |
| 1,000,000 paused | 18.5 / 47.4 ms | 72.8 ms | 5.8 / 7.4 ms | 21.9 ms |

The million-point scene first rendered in 187 ms and used 194.5 MiB of
sampled luma GPU memory above the initial viewer. Shrink and regrowth to
one million took 14 and 148 ms. These are tests of the current WebGL Graph
with a basic scatterplot and the given label requests.

The verified run is in `captures/production-graph-readback-verified-m3-20261120-043650/`
with source archive SHA-256
`ec2832cd8fe34d9e33347551b35ca5ad3a7645cc997dcd30e266e812501a1165` and production
UMD SHA-256 `71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d`.
The earlier `captures/production-graph-readback-m3-20261120-043528/` run had
a Vite dependency reload and retained 188.2 and 499.0 ms selection outliers.
The clean replay prebundles the label renderer. The full selection highlight
on a moving million-point production WebGPU Graph remains open.

Build the production bundle before the run and set its checksum and the Lab's
source and capture variables.

```sh
VITE_LAB_PRODUCTION_SHA256=$(shasum -a 256 dist/index.min.js | cut -d' ' -f1)
export LAB_NATIVE_VISIBLE=1 VITE_LAB_GRAPH_READBACK=1 VITE_LAB_PRODUCTION_SHA256
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/viewer-comparison/graph-readback.test.ts
```

## Resident million-point selection and labels

Use the dense and hub viewers' GPU buffers with the same asynchronous area
and tracker implementation. Keep Four corners, Reduced drawing, a fixed Fit
camera and the native 961 × 541 CSS viewport at DPR 2. After four warmup
ticks, alternate rectangle and polygon queries after eight moving submissions.
Each query updates a selection count, and the coalesced tracker drives the
Storybook label renderer for 1,000 requested IDs. Record time to the count and
to the next animation opportunity after the labels update. The full selection
highlight has its own draw cost.

At the final positions, compare both query results and every gathered
coordinate to an independent CPU check. Use pending queries to verify that
removing a point or replacing the topology discards their earlier results.

Both fixtures returned exact area IDs and gathered positions, and both
discarded the pending reads on removal or topology replacement. The native
M3 run used Apple Metal 3, visible Chrome 157 and luma 10.0.0-alpha.15.

| Workload | Area result median / max | Results within 100 ms | Label presentation median / max | Labels within 33 ms |
| --- | ---: | ---: | ---: | ---: |
| Dense | 37.0 / 48.9 ms | 8/8 | 49.1 / 64.7 ms | 0/8 |
| Hub | 41.4 / 42.5 ms | 8/8 | 49.1 / 65.8 ms | 0/8 |

The area requests selected roughly 98,000–125,000 IDs. Sampled GPU memory
peaked at 227.7 MiB in each lane, including the style and readback resources.
Area queries meet the result budget. Label presentation misses its budget
when a gather follows the full moving graph tick and the caller polls on
animation frames. The capture is in `captures/resident-readback-m3-20261120-044912/`
with source archive SHA-256
`ac578cec74b2019be841645920a7d591138e402e97dad25e3152fb686d95e157`.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_RESIDENT_READBACK=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/million-graph/resident-readback.test.ts
```

## Reproduce

Use the native adapter in visible Chrome. Set a unique `LAB_ARTIFACT_RUN`,
`LAB_SOURCE_REVISION` and `LAB_SOURCE_SNAPSHOT`.

```sh
LAB_NATIVE_VISIBLE=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu \
  src/experiments/integrated-webgpu/readback.test.ts \
  src/experiments/integrated-webgpu/tracked-points.test.ts \
  src/experiments/integrated-webgpu/runtime.test.ts \
  src/experiments/selection/selection.test.ts
```
