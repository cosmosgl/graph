## Stable CSR, twice

CSR stores each point's adjacency as a contiguous range. With edges `0→1, 0→2, 2→1`:

| Direction | Offsets | Neighbors |
| --- | --- | --- |
| By source | `[0, 2, 2, 3]` | `[1, 2, 1]` |
| By target | `[0, 0, 2, 3]` | `[0, 2, 0]` |

Point `i` walks slots `offsets[i] … offsets[i+1]−1`. The final offset equals the number of valid edges.
Each slot keeps its original edge ID while building bias, resolved strength and directional distance sample.
Duplicates and self-loops are retained. Invalid endpoints are skipped without renumbering the input's edge IDs.

The builder uses count → prefix sum → stable fill on the CPU, O(V + E). It runs when connectivity is replaced,
not every simulation tick. This matches Cosmos's existing topology ownership and avoids nondeterministic
atomic scatter order. GPU topology construction is a separate optimization: it must preserve the spring's
order contract, not merely produce the correct neighbor set.

## Storage layout and luma compatibility

All packages remain pinned to **luma 10.0.0-alpha.4**. The installed package APIs are the compatibility
source of truth; newer online documentation may describe different exports.

| Resource | Layout / ownership |
| --- | --- |
| Two simulation buffers plus benchmark scratch | `vec4<f32>` = x, y, pinned, absent; ping-pong for simulation; scratch keeps P0 frozen during timing |
| Two force buffers | `vec4<f32>`; separate outputs retained for diagnostic comparison |
| Direction offsets | `u32[V+1]` |
| Direction edge records | 16 bytes: neighbor `u32`, bias `f32`, resolved strength `f32`, random sample `f32` |
| Render links | Original valid endpoint pairs as `u32` |
| Sizes | `f32[V]`; used for the collision rest-length floor |
| Parameters | 48-byte uniform buffer |

The WebGPU path uses `device.createBuffer`, `Kernel`, `RenderKernel`, luma compute/render passes,
`device.submit`, `Buffer.readAsync` and optional `QuerySet` timestamps. Explicit shader layouts map binding
names to slots. Buffer usages declare storage, copy and uniform roles; readback is diagnostic only.
Luma fences separate submitted work from completed work in measurements.
No native compute or render pipelines are created by the experiment.

One invocation owns one point's result. It walks that point's adjacency serially, so no floating-point
atomic accumulation or compute blending is needed. Standard [WGSL atomics](https://www.w3.org/TR/WGSL/#atomic-builtin-functions)
operate on integer atomic types; this design does not depend on optional float atomic support.

Compute uses workgroups of 64 invocations. Hubs remain a load-balance risk: one invocation must preserve a
long spring sequence. Increasing parallelism across a hub's edges is not automatically semantics-preserving.

## WebGL through luma Model

The WebGL backend uses luma `Model` for both directional springs, integration, points and lines.
`UniformStore` supplies the production GLSL uniform blocks; luma textures, framebuffers and render
passes own simulation state and draws. GPU timing uses luma `QuerySet`. No native shader programs,
pipelines, uniforms or draw calls are constructed by this backend.

Each spring model uses its **own direction's maximum adjacency count**, matching the two production
`ForceLink` instances. For a 100,000-point outward star the bounds are **99,999 and 1**; reversing all
edges reverses those bounds. Total degree still determines spring bias, but never the shared bound
of both shader programs. Empty directions compile with a zero bound.

Two pinned-version details matter: framebuffers need explicit width/height for the render-pass viewport,
and a managed uniform buffer must exist before `setUniforms` uploads values. Regression tests check
complete textures, both integration substeps, replacement and reset so a partial render cannot pass.

Diagnostics also use luma APIs. Context loss is checked with `Device.isLost` and error callbacks;
completion uses a luma fence. Image comparisons draw into an explicit RGBA8 framebuffer and use
luma readback, since this alpha cannot read the default canvas framebuffer through its helper.
Simulation texture readback uses `Texture.readDataSyncWebGL`. Reads stay outside GPU timing queries.
The diagnostic error surface now comes from luma; it does not poll native WebGL error codes.

Exports identify this baseline as `luma-model-directional-v1` and record per-case directional bounds.
Earlier raw-WebGL captures used a total-degree bound for both passes and must not be pooled with it.

## GPU-resident rendering

After both directional integrations, the renderer reads the final position buffer directly. Thin lines
fetch both endpoint indices; circle points expand into six vertices. WebGL fetches the analogous position
texture and uses point sprites. Neither render path downloads or repacks positions each tick.

The camera, five-pixel points and one-pixel straight links are intentionally minimal. This is not evidence
for Cosmos link styling, arrows, curves, picking or renderer parity.

## Updates and lifetime

“Replace links + reset” changes connectivity and edge count in the same point index space, rebuilds both
CSR lists and recreates backend resources. The demo explicitly resets the simulation. Tests also grow point
and link capacities on the same device. This proves replacement/reallocation, not incremental mutation or
state-preserving live updates.

The backend owns its device and resources. Resources are destroyed on replacement and navigation; pending
measurements finish before teardown. Borrowed device ownership, device-loss recovery, GPUCommandGraph,
buffer-view suballocation and incremental capacity reuse remain separate integration questions.

## Validation of the luma conversion

The browser regression suite checks both forces and integration substeps at the unchanged tolerance
`abs(error) ≤ 2e−6 + 2e−5 × abs(reference)`. It includes 100k-star trajectories and all timed stages
with both directional bounds and the optional early exit, plus image equality for bounded/single draws.
These checks run on Chromium's software GPU adapter and are not native performance evidence.

The in-app browser could not create a WebGL context after the earlier losses. A follow-up in standalone
Chrome 156 on Apple M3 / ANGLE Metal ran the corrected baseline: the 1k control passed 25 ticks;
the 100k star passed snapshots 1 and 10, then lost its context during the fence wait at tick 18.
The capture confirms bounds [99,999, 1]. No second trajectory or performance measurement was attempted
after loss. The [native investigation](#/weighted-links/docs/context-loss) records the evidence and limits.
