# Gather tracked positions from the GPU

Can a WebGPU tracker return just the requested coordinates from a moving graph?
The experiment borrows the combined layout's current position buffer, gathers
the requested IDs in a compute pass and reads the compact result asynchronously.
Each request copies eight bytes per ID. No full-graph readback is needed by the
tracker. The test reads the full graph separately as a reference for one step.

## Declared check

Use a 257-point chain with a pin and an absent point. Compare ordered XY pairs
and the ID-to-position map exactly against the fixture or the GPU layout's
current positions. Include repeated IDs, NaN slots for invalid or absent IDs,
an empty request, the alternate position buffer after gravity, and a 97-ID
request crossing a workgroup boundary.

Start one gather before updating the input list and patching availability.
Start another gather afterward. The two requests must each return their
own snapshot. Shrink to 32 points and regrow to 257, preserving the live prefix.
IDs beyond the current count must disappear and return when the data regrows.
Require no device validation errors.

The probe returns a snapshot for each asynchronous request. Production still
needs a policy for serving latest or cached positions through the synchronous
tracker API, suppressing stale results after removal, scheduling overlays, and
sampling labels in screen space. [WebGPU buffer mapping](https://www.w3.org/TR/webgpu/#buffer-mapping)

The [live graph readback study](#/integrated-webgpu?section=doc-readback) tests
an async fresh snapshot and a synchronous latest-completed cache on the same
layout and validates how the cache drops removed IDs.

## M3 result

All eight requests matched exactly on 19 November 2026 in visible Chrome
157 with native Apple Metal 3 WebGPU and luma 10.0.0-alpha.15. The two overlapping
requests each saw their own ID list and position snapshot across the patch.
The test saw no GPU errors. The 97-ID request read 776 bytes from a live position
buffer with 4,112 logical bytes. No end-to-end label latency was measured.

The first attempt failed shader compilation when evaluating a NaN constant as
`f32`. The tested kernel writes integer bit patterns, including the missing
value, and the CPU interprets the copied bits as floats.

The passing capture is `captures/tracked-points-m3-20261119-uUPpOWIQ/`,
with frozen source SHA-256
`fe86703067aaf2c75deded2e859ab4b0251c5d2b42901f28f668a9ced849f022`.
The first attempt is retained in
`captures/tracked-points-m3-20261119-0R0ExSeU/`. Both were captured from base
revision `d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`.

## Reproduce

Declare a unique `LAB_ARTIFACT_RUN`, `LAB_SOURCE_REVISION` and
`LAB_SOURCE_SNAPSHOT`, then use a visible browser on the native GPU.

```sh
LAB_NATIVE_VISIBLE=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/tracked-points.test.ts
```
