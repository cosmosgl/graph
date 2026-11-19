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

The study tests a planned loss signal and manual restart from saved positions.
Automatic recovery of the full viewer, unplanned loss, restoring a complete
public graph session, deck.gl integration and performance remain open.

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

## Production dependency

The production Graph and Cosmos deck layer declare luma `~9.3.0` peers. The
workspace resolves luma 9.3.6 and deck.gl core 9.3.10. The installed deck.gl
core declares luma `^9.3.5` dependencies. The Lab's luma 10.0.0-alpha.15 is
outside both production ranges. Sharing a Lab luma device establishes a
prototype contract. A production host still needs one mutually supported
luma package family and the production draw and position-sharing contracts
on that family.
