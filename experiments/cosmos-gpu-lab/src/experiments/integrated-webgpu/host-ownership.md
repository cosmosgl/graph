# Shared WebGPU device and recovery

Can a host draw directly from the layout's current GPU buffer, keep operating
after layout cleanup, and restart from a retained checkpoint after device loss?
This check uses a host-created luma WebGPU device and the combined layout's
borrowed-device context. The integrated viewer still creates its own device and
render passes.

## Declared check

Use a visible native browser on Apple M3 and luma 10.0.0-alpha.15. The host
owns a 512 × 64 RGBA8 attachment, a fixed marker and a render pass. The layout
uses a 32-point chain with an unpinned point at clip coordinates (−0.625, 0).
The host draws a marker using the layout's current position buffer, then draws
its own fixed marker in the same pass. Check exact RGBA at both markers. Advance
one gravity stage at alpha 1 and require a different current GPU buffer, the
marker at its CPU reference pixel and black at its old pixel. The host uses the
resident buffer for those draws. Afterward the harness reads back a checkpoint.

Destroy the layout and verify both position buffers were released, the layout
buffer ledger is empty, and the host can still draw its own marker. Recreate the
layout on that host device, verify a draw, then deliberately destroy the device
through luma's public API. Require a `destroyed` loss notification, rejection of
further layout work, and successful layout resource cleanup. Create a fresh host
device and canvas, re-upload the checkpoint, require exact restored positions
and verify the next gravity step against the CPU reference again.

This lane tests a planned loss signal and manual restart from saved positions.
Automatic recovery of the full viewer, restoring a complete public graph
session, and production Deck hosting remain open.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_HOST_OWNERSHIP=1 LAB_ARTIFACT_RUN=host-ownership-20261119-r1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/host-ownership.test.ts
```

## M3 result

The 19 November 2026 check passed in visible Chrome 157 on Apple M3. Both
devices reported Apple WebGPU (`metal-3`, `fallback: false`) with luma
10.0.0-alpha.15. The graph marker moved from pixel 96 to 99 on the alternate
GPU buffer. The host marker at pixel 416 stayed visible through layout cleanup
and reconstruction on the same device. Tracked layout buffers fell from 30
(58,032 bytes) to zero while the host device remained usable.

The explicit device destruction delivered `destroyed`. The old layout
rejected further simulation work and released its remaining tracked buffers.
The replacement device restored all 128 position values exactly. The resumed
gravity step moved the graph marker from pixel 99 to 102 as predicted. Neither
device reported additional GPU errors.

The raw capture, declared protocol and frozen source are in
`captures/host-ownership-20261119-q8j4bm0p/`. The source archive SHA-256 is
`eada5cade749372c81eb8d3c9d8c5692319b50d8ec96e554e26c76271e2714b8`.

## Chrome GPU process loss during motion

Repeat the host swap, cleanup and checkpoint checks, then keep submitting
simulation and host draw work. Trigger Chrome's documented GPU process-loss
command against the test runner's isolated browser. Require a device loss
notification with reason `unknown`, rejection of further work on the old
device, release of the old buffers, and exact restoration and movement on
a new native device. The original explicit destruction lane stays separate.
[Chrome DevTools command](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-crashGpuProcess)

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_HOST_OWNERSHIP=1 VITE_LAB_GPU_PROCESS_LOSS=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/host-ownership.test.ts
```

Use a fresh source snapshot and artifact run. The replay is enabled only
in the test runner's own visible Chrome instance.

On M3, Chrome 157 delivered `unknown` after one moving frame was submitted
in the recovery lane. The old device rejected simulation work and its layout
buffers were released. Both devices reported native Apple Metal 3 WebGPU.
The new host restored all 128 position values exactly and moved the graph
marker from pixel 99 to 102 on the next gravity step. This is a manual host
restart from a checkpoint on luma 10.0.0-alpha.15.

The result is in `captures/host-gpu-loss-m3-20261120-041300/` with source
archive SHA-256
`ca5fde10b329fd92711ee2d8b6a8213eddc15c6fd7141580f199feef2ad690da`.

## Production dependency

The production Graph and Cosmos deck layer declare luma `~9.3.0` peers. The
workspace resolves luma 9.3.6 and deck.gl core 9.3.10. The installed deck.gl
core declares luma `^9.3.5` dependencies. The Lab's luma 10.0.0-alpha.15 is
outside both production ranges. Sharing a Lab luma device establishes a
prototype contract. A production host still needs one mutually supported
luma package family and the production draw and position-sharing contracts
on that family.
## Deck host on one luma family

The published deck.gl `10.0.0-alpha.1` Core package uses luma
`10.0.0-alpha.14`. The isolated host test pins the Lab's core, graph, engine
and shaders to the same version. A separate resolution check confirms that
Deck and the Lab load each package from the same installation. The main
Lab uses alpha.15.
[Deck prerelease](https://github.com/visgl/deck.gl/releases/tag/v10.0.0-alpha.1)

On the native M3 adapter in visible Chrome 157, a Deck layer drew a marker
from the Lab layout's current GPU buffer in Deck's render pass. Deck, the
layout and the layer used the same device object. The 512 × 256 offscreen
view used an orthographic camera. The GPU gravity step swapped the resident
buffer, and the projected pixels and asynchronous Deck pick still returned
point ID 0 after a camera change. The fixture has 32 slots, with one present
point and a separate green host marker.

Removing the layout layer let Deck continue drawing the host marker. The
old point disappeared from pixels and picks. Layout cleanup released all
tracked buffers, and finalizing Deck left the borrowed device usable. The
first attempt destroyed the layout before Deck applied the new layer list,
which left two draws referencing destroyed resources. The passing replay
waits for the layer finalization before destroying the layout.

The passing capture and dependency resolution are in
`captures/deck-host-m3-a2646e35/`, with source SHA-256
`4be39476cd0b4862dbc5c568532cc42cf36c5de7e521865645f481273527746d`.
The rejected removal order is in `captures/deck-host-m3-70318046/`, with
source SHA-256 `e604067f8f484864f3d32d1e6386e2acff4489ddc4b437fab4bb878ee7d4b44f`.

Use the pinned alpha.14 pair for this host proof. Production adoption still
requires a common supported luma version and the full Graph layer, link and
style draws, overlay styling and unplanned recovery. The installed production
Deck layer runs on the luma 9.3 family. Deck's published guide describes v9
WebGPU as experimental. [Deck WebGPU guide](https://deck.gl/next/docs/developer-guide/webgpu)

### Replay the isolated Deck test

The archived source includes the exact manifests and lockfile. Extract it
into a temporary directory, install that workspace with
`pnpm --filter @cosmos.gl/gpu-lab... install --frozen-lockfile --ignore-scripts`,
and set a new `LAB_ARTIFACT_RUN`, the base commit in `LAB_SOURCE_REVISION`
and the absolute archive path in `LAB_SOURCE_SNAPSHOT`.

```sh
LAB_DECK_HOST=1 LAB_NATIVE_VISIBLE=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu
```
