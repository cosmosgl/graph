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
The packed Graph and Deck consumer below also exercises a moving session after
Chrome loses its GPU process.

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

### Chrome default WebGPU availability

Repeat the two moving [viewer checks](#/viewer-comparison?section=doc-agent-recipe-fractional-styles-on-moving-geometry)
on M3 without the runner's `--enable-unsafe-webgpu` argument. Require the
non-fallback adapter, visible style comparisons and actual object picks.
Use the built production WebGL Graph as the paint control. This checks the
initialized backend and actual interaction on the stated Chrome build.

The replay passed in visible Chrome 157 on the native M3 Metal 3 adapter.
All eight style frames matched interior colors and point IDs. The test
kept the 993 boundary color differences and passed all eight pointer
checks on the crossing fixture. The full production Deck check below
also exercised the current WebGL path with `navigator.gpu` unavailable.
This initial browser scope covers Chrome on M3.

The native-flag replay is in `captures/default-chrome-m3-20261120-052344/`
with source archive SHA-256
`1c786d611d72fad0c8e76ab7274c9581fdbe756fe06a058b73431020a98e68be`
and production UMD SHA-256
`71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d`.

```sh
LAB_NATIVE_VISIBLE=1 LAB_DEFAULT_GPU_FLAGS=1 VITE_LAB_MOTION_STYLES=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/viewer-comparison/motion-styles.test.ts
```

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
requires a qualified release dependency family, overlay styling and unplanned
recovery. The packed consumer below covers the full layer with straight links. The installed production
Deck layer runs on the luma 9.3 family. Deck's published guide describes v9
WebGPU as experimental. [Deck WebGPU guide](https://deck.gl/next/docs/developer-guide/webgpu)

## Full production Graph and Deck control

Run the shipped `Graph` and `CosmosGraphLayer` together on their shared
luma 9.3 device in visible M3 Chrome. Verify draw placement, point and link
IDs, ownership and layer teardown. Simulate WebGPU absence at the navigator
boundary to exercise that startup path. Submit a fresh simulation tick and
trigger Chrome GPU process loss. Record the browser's context loss event,
dispose the old host and layer, then restore the checkpoint in a new Deck
instance and pick the same items. This establishes the WebGL control and
the available host behavior before a compatible production WebGPU build.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_GPU_PROCESS_LOSS=1 VITE_LAB_NATIVE_PRODUCTION_HOST=1 \
  pnpm test test/deck-layers.test.ts -t 'restores the native production Graph'
```

The M3 replay passed on visible Chrome 157, luma 9.3.6 and deck.gl 9.3.10.
The original and replacement hosts reported native Apple M3 ANGLE Metal
WebGL 2. A trusted `webglcontextlost` event accompanied the luma loss
notification. That luma version labels the WebGL notification `destroyed`.
The team-owned test browser's GPU process triggered the event while the
graph was stepping. Finalizing Deck released the original Graph. The new
Deck restored all coordinates and picked point 0 and link 0 on the same
borrowed-device contract. This path starts and recovers with the WebGPU
API hidden.

The result is in `captures/production-deck-loss-m3-20261120-045119/` with
source archive SHA-256
`5d2f9e3642e8f7d2ac5500472e4754c34c0f3687a4fb7e57ae74f09f9570df44`.
An earlier run in `captures/production-deck-loss-m3-20261120-044550/` checked
the event before its listener ran. The passing replay waits for both the
browser event and the luma loss promise.

### Replay the isolated Deck test

The archived source includes the exact manifests and lockfile. Extract it
into a temporary directory, install that workspace with
`pnpm --filter @cosmos.gl/gpu-lab... install --frozen-lockfile --ignore-scripts`,
and set a new `LAB_ARTIFACT_RUN`, the base commit in `LAB_SOURCE_REVISION`
and the absolute archive path in `LAB_SOURCE_SNAPSHOT`.

```sh
LAB_DECK_HOST=1 LAB_NATIVE_VISIBLE=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

## Packed WebGPU Graph and CosmosGraphLayer

A clean TypeScript app installs local tarballs of `@cosmos.gl/graph` and
`@cosmos.gl/deck-layers`, both version 3.6.0. The published Deck core
10.0.0-alpha.1 shares luma core 10.0.0-alpha.14 with both candidates.
The app builds with strict TypeScript 5.9.3 and Vite 6.4.3.
`skipLibCheck` is enabled for the upstream declaration files.

On 24 November 2026, visible Chrome 158.0.8127.37 on Apple M3 reported
Apple WebGPU, `metal-3`, with `fallback: false`. Both ownership modes drew
the expected red and green point interiors, blue link midpoint and black
background at 320 × 192 and 512 × 320 CSS pixels at pixel ratio 1.
Deck's `pickObjectAsync` returned point indices 0 and 1, link index 0,
and a background miss. After resize the first point's old location was black
and returned no pick.

| Ownership | Pick payload | After removing the layer |
| --- | --- | --- |
| Layer creates Graph and loads object arrays | Original point and link records | Graph became unready and released its position buffer. |
| Application supplies Graph with typed arrays | Element type and index | Graph remained ready. Moving point 1 to (1090, 1040) returned those coordinates on readback. |

After removal the canvas cleared and Deck returned no hits in either mode.
After Graph and Deck teardown, a buffer on the borrowed device returned all
four bytes the app wrote. The first run drew correctly but picked nothing.
Deck 10 supplied the layer ID in `blendConstant[3]`. Forwarding that value
to the Graph pick shader restored the point and link hits.

On 25 November the app-supplied graph showed only the link on a Retina
display. Deck drew into a canvas with one backing pixel per CSS pixel, while
the Graph used the display ratio of two to shade each point. Deck now passes
its actual pixel ratio to the Graph on every draw and pick. A repeat on M3
checked both ownership modes at display ratios 1 and 2 with the canvas ratio
fixed at 1. Both point centers and the link matched their exact colors on
first paint and after resize. All picks and teardown checks passed in all
four cases. The capture is in `captures/packed-deck-retina-m3-20261125/`.

Rebuild both tarballs and the app from the repository root.

```sh
sh scripts/prepare-packed-webgpu-deck.sh
```

The script prints the clean app directory, the native Chrome verification
command and the command to open the app. The browser check emits JSON with the
adapter, Chrome version, tarball hashes, pixel samples, picks and teardown
results. The M3 replay is in `captures/packed-deck-m3-20261124/results.json`.
The fixture at `d0ff27ed` covers one orthographic view and a paused two-point graph.

### Recovering a moving Deck session

On M3, the packed app restored a moving two-point graph from its last completed
checkpoint. The host had moved one endpoint, pinned and selected the other,
changed the spring strength, and panned, zoomed and resized the view. The
verifier then stopped the GPU process in its own Chrome instance. The host
received a device-loss notification with reason `unknown` and rebuilt Deck and
the graph on a fresh native device in the same page.

Both layer-owned and app-supplied graphs restored the exact saved coordinates,
camera, viewport, pin and highlighted point. On the first restored draw, the
selected pin was red, the other point yellow and the link blue. Deck picked
both points and the link and returned no hit on the background. On the first
resumed tick the simulation reported exactly the same cooling value as the
uninterrupted session at that tick. The free point moved while the pin stayed
fixed. Paint and picking passed again after resize, and the replacement device
remained usable after teardown.

The application retains the graph records and reads the checkpoint before loss.
Motion resumes at that snapshot, so the interval between checkpoints determines
how much recent motion can be lost. The original Chrome GPU-process loss test used two points and one link.

The same packed-app verifier runs the four normal ownership and display-ratio
cases and both recovery cases. The M3 run is in
`captures/packed-deck-recovery-m3-N6YbONc6/results.json`.


### Checkpointing 65,536 points

The clean TypeScript app installs local Graph and Deck Layers 3.6.1 tarballs
with Deck 10.0.0-alpha.1 and luma 10.0.0-alpha.14. The larger fixture contains
65,536 points and 32,768 springs. The CPU checkpoint stores 524,288
bytes of Float32 XY coordinates as a JavaScript array. It also saves the camera, viewport, pins, selected IDs,
spring strength, cooling and running state. Both ownership modes reproduced
every coordinate and the first resumed cooling value. Deck returned the
original picks before and after resize and the supplied device remained usable
after teardown.

| Browser on the M3 host | Loss exercised | Checkpoint, layer / app (ms) | Remount through restored state, layer / app (ms) |
| --- | --- | ---: | ---: |
| Chrome 158, Apple Metal | Test browser's GPU process crash | 8.8 / 9.1 | 211 / 224 |
| Firefox 153, non-fallback, adapter name unavailable | Explicit destruction of the test device | 34 / 47 | 198 / 187 |
| WebKit 26.5, Apple | Explicit destruction of the test device | 11 / 11 | 124 / 107 |
| Chrome 158, SwiftShader | Test browser's GPU process crash | 3,359 / 2,731 | 5,442 / 4,532 |

These are individual observations, with the camera and first rendered pixels
checked separately. Firefox and WebKit both delivered the device-loss
notification and restored the session on a new device. A retail Safari
WebDriver run still requires Remote Automation to be enabled. Additional
physical GPU families need their own qualification runs.

Run the same checks from the repository root. The preparation script prints
the temporary application directory to use for each command.

```sh
sh scripts/prepare-packed-webgpu-deck.sh
node scripts/check-packed-webgpu-deck.mjs "$app_dir" --points 65536
node scripts/check-packed-webgpu-deck.mjs "$app_dir" --browser firefox --points 65536
node scripts/check-packed-webgpu-deck.mjs "$app_dir" --browser webkit --points 65536
node scripts/check-packed-webgpu-deck.mjs "$app_dir" --swiftshader --points 65536
```

The local capture `captures/packed-deck-milestone-20261126/` retains the
application, both tarballs, browser reports and the original Firefox compile
error. Browser and adapter details and the SHA-256 of each tarball are in
each report.
