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
