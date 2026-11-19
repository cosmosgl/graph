# Rectangle and polygon selection

## What we compare

The test asks whether WebGPU returns the same point IDs as the production rectangle and polygon shaders for a fixed set of CSS-coordinate queries. The WebGL control runs the original GLSL and point-size helper on already-resolved positions, sizes and absence flags. The independent CPU reference projects into top-left CSS pixels, computes overlap with the drawn sprite for rectangles and counts polygon ray crossings for point centers. The WebGPU candidate writes a flag per point and reads back ordered IDs asynchronously.

The declared check is exact ordered ID agreement between all three on all 19 queries. Hand-checked cases cover inclusive rectangle edges, the one-device-pixel minimum, zoom scaling and clamping, zero size and absence, concavity and polygon boundaries, paths shorter than three vertices, the legacy 2,048-edge cutoff, and input replacement. A 257-point fixture with seed `29471` checks row ordering, oblique polygon edges and a non-power-of-two viewport. Queries with an exact boundary use coordinates chosen to be representable in both shaders.

## Native M3 result

**19 of 19 queries returned exactly the same ordered IDs** in the independent CPU reference, the production WebGL shaders and the WebGPU candidate on 19 November 2026. Seventeen queries ran on both GPUs. An empty point set and a two-vertex polygon returned empty arrays before dispatch. With the same panned view, scaling point footprints with zoom changed rectangle membership from 10 to 14 IDs in all three paths. The legacy polygon edge cutoff changed the longer path’s result from 7 to 15 IDs when the closing edge fell beyond the cutoff. WebGPU reproduced that behavior.

Visible Chrome 157 reported ANGLE Metal on Apple M3 for WebGL and non-fallback Apple `metal-3` for WebGPU. The lab used luma.gl `10.0.0-alpha.15`, Node `v24.6.0` and pnpm `10.15.0`. The two browser tests and Lab typecheck passed.

## Production gaps

Production setter and transition behavior, arbitrary near-edge rounding, browser pointer wiring and million-point query cost remain open. `Graph.findPointsInRect` and `Graph.findPointsInPolygon` currently return arrays synchronously. The latest GPU-produced flags in this candidate arrive through async readback, so the production API still needs a compatibility decision. [WebGPU buffer mapping](https://www.w3.org/TR/webgpu/#buffer-mapping)

## Reproduce

The recorded run is under `captures/selection-20261119-ja9befei/`. It contains `selection-parity.json`, `native.log`, `context.json`, the declared protocol and the exact `source.tar.gz` used for the test. The archive SHA-256 is `d198ad584c8e488a5dc4bf036020fbbbcef51f95868545e382181d857e3aa970`.

Run the fixture from the archived source or a clean revision with the locked packages installed. Set `LAB_SOURCE_REVISION` to the tested revision and `LAB_SOURCE_SNAPSHOT` to the archive path when replaying a source snapshot.

```sh
LAB_NATIVE_VISIBLE=1 LAB_ARTIFACT_RUN="selection-$(date -u +%Y%m%dT%H%M%SZ)" \
  pnpm --dir experiments/cosmos-gpu-lab run test:gpu src/experiments/selection/selection.test.ts
```
