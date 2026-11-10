This inventory maps **current Cosmos behavior** to the evidence in the lab. It covers eight force types,
point and link rendering, and the supporting interactions a replacement backend must preserve.
Reviewed **9 November 2026** against the production source in this repository.

The [migration roadmap](#/roadmap) describes the overall readiness decision; this page is the feature checklist.
All current experiments use luma v10 APIs for GPU resources, execution, timing and readback.

## How to read coverage

- **Covered in isolation** — an experiment implements and checks the named capability. This does not establish complete-engine or all-device parity.
- **Partial** — some behavior or a supporting primitive is demonstrated; the rest still needs validation.
- **Needs validation** — no experiment yet implements and checks the production feature on WebGPU. A related demo is not evidence of parity.

Every row states the remaining work. Coverage is not a completion percentage or a performance guarantee.
Historical measurements made before the luma API migration need fresh runs. The native v10 WebGL
[100k-star context-loss investigation](#/weighted-links/docs/context-loss) remains unresolved and parked;
failed baseline runs cannot support performance comparisons.

## 1. Simulation forces

WebGL 2 has no compute shaders. Cosmos uses render passes into floating-point textures: a texel represents
one point, a fragment reads its inputs with `texelFetch`, and the pass writes a correction or new position.
Position textures alternate between reading and writing. Aggregations use rasterization and additive blending.

| Force | How production WebGL works | WebGPU coverage and remaining validation |
| --- | --- | --- |
| **Gravity** · `simulationGravity` | A fragment per point computes a linear pull toward the fixed world origin, scaled by strength and simulation temperature (`alpha`). | **Needs validation.** Port the force and compare origin, strength, cooling and ordered position updates. |
| **Center** · `simulationCenter` | Points blend position sums and count into a 1×1 floating-point target. A second pass divides by count and pulls each point toward the current centroid. | **Partial.** [Center of mass](#/center-mass) and [scalable reduction](#/scalable-reduction) cover the aggregation. They do not implement the production center-attraction pass. Validate that pass, absent-point handling and its place in the force sequence. |
| **Many-body repulsion** · `simulationRepulsion` | Up to 4,096 points, checks every pair. Larger graphs use hierarchical grid sums/counts for distant contributions and depth-selected samples of actual points for nearby contributions. | **Partial.** [Global many-body](#/many-body) checks the exact all-pairs production GLSL against direct/tiled WGSL and CPU, including coincident, absent and pinned points. [Hierarchical repulsion](#/many-body-grid) adds shared-bounds grid/sample construction and force checks above 4,096 points. Dense CPU precision remains unresolved; GPU bounds, adaptive sampling, scaling and convergence still need validation. [Neighborhood forces](#/neighborhood-forces) remains a different, radius-limited force. |
| **Link springs** · `simulationLinkSpring` | Adjacency textures describe each point's neighbors. Each fragment accumulates ordered spring corrections using rest lengths, degree bias and strength. Incoming and outgoing passes each integrate before the next starts. | **Partial.** [Weighted links](#/weighted-links) checks both directional forces and integration against production GLSL and a CPU reference, including weights, random rest distances, duplicates, self-loops and replacement. Validate longer trajectories, state-preserving topology changes, force composition and native scaling. |
| **Cluster attraction** · `simulationCluster` | Additive blending computes a center per cluster. Points read that center or an explicit cluster target and apply global and per-point attraction strengths. | **Needs validation.** Global reduction is only a building block. Implement grouped aggregation, custom targets, missing membership and per-point strengths. |
| **Per-point attractors** · `simulationAttractor` | A texture stores target coordinates, strength and target presence. Each fragment pulls its point toward its target; missing targets contribute zero. | **Needs validation.** Check targets, strengths, absent targets, updates and cooling. |
| **Mouse repulsion** · `simulationRepulsionFromMouse` | A fragment per point computes inverse-square repulsion from the pointer with a minimum-distance clamp. It can run independently of the main simulation. | **Needs validation.** Check screen-to-world coordinates, paused simulation, force magnitude and interaction timing. |
| **Collision** · `simulationCollision` | Up to 4,096 points, resolves every pair. Larger graphs use spatial hashing with depth-selected neighbor slots. Radius-based overlap corrections can repeat several times per tick. | **Needs validation.** The [grid builder](#/spatial-grid) and local repulsion are infrastructure, not collision. Test variable radii, padding, pinned points, dense overlaps, iterations and cooling. The spring rest-length floor is checked in weighted links, but overlap resolution is not. |

Gravity attracts toward a **fixed origin**; center attracts toward the **moving centroid** and contracts the layout
around it. Collision is a positional constraint: its correction uses friction 1 and, by default, does not cool with alpha.

### Force order is part of the behavior

Each enabled force sees the positions produced by the preceding force. Combining all forces into one sum
and integrating once would change Cosmos's current behavior.

```flow
Optional mouse repulsion · integrate
Gravity · integrate
Center · integrate
Many-body repulsion · integrate
Incoming springs · integrate
Outgoing springs · integrate
Cluster attraction · integrate
Per-point attractors · integrate
Collision · integrate; repeat configured iterations
Cool simulation
```

Mouse repulsion has its own execution gate; the regular force sequence runs only when simulation is requested.
Disabled or inapplicable forces are skipped.

| Simulation mechanism | WebGL behavior | WebGPU coverage and remaining validation |
| --- | --- | --- |
| **Integration and friction** | A separate pass applies the correction, preserves pinned/absent points and guards invalid or excessive steps; position textures are swapped before writing. | **Partial.** [Weighted links](#/weighted-links/docs/results) exercises the production integrator in the spring sequence. The neighborhood demo has its own damping and reflecting walls. Validate the complete Cosmos sequence and numerical guards together. |
| **Cooling and lifecycle** | CPU scheduling updates alpha, controls stepping/pause/resume and emits lifecycle callbacks. | **Needs validation.** Demo step/play controls do not prove the production cooling schedule or API behavior. |
| **Pinning and dragging** | Pin status prevents integration from moving a point; dragging writes its position through a GPU pass. | **Partial.** Weighted links checks pinned points. Pointer-driven dragging, live pin changes and interaction with all forces remain unvalidated. |

## 2. Point rendering

Production draws one vertex per point. The vertex shader reads its current position and sets `gl_PointSize`;
the fragment shader uses the sprite's local coordinates to form shapes, edges and images.
The WebGPU circle experiment expands each point into a quad because portable wide point sprites are unavailable.

| Feature | How production WebGL works | WebGPU coverage and remaining validation |
| --- | --- | --- |
| **Circle primitive** | A point sprite's fragment shader computes circular coverage. | **Covered in isolation.** [Circle rendering](#/point-rendering) compares WebGL sprites with WebGPU instanced quads; [neighborhood forces](#/neighborhood-forces) renders circles from resident simulation buffers. Full visual parity still needs zoom, pixel-ratio and overlap cases. |
| **Other shapes** | Distance calculations define square, triangle, diamond, pentagon, hexagon, star and cross; “none” disables the shape. | **Needs validation.** Minimal square markers in compute demos do not test Cosmos's shape selection, geometry or coverage. |
| **Colors, sizes and opacity** | Per-point attributes and global uniforms control color, diameter, alpha and zoom scaling. | **Partial.** [Circle rendering](#/point-rendering) covers per-point colors, a shared diameter and alpha blending. Validate per-point sizes, production opacity/default rules and zoom-dependent sizing. |
| **Antialiasing and tiny points** | Smooth edge coverage; subpixel points reduce opacity to preserve approximate visual area. | **Partial.** Circle edge smoothing is demonstrated. Validate Cosmos's exact edge ramp, tiny-point area behavior and high-DPI output. |
| **Inside strokes** | A distance-based inset band follows the shape edge; explicit colors or OKLab-derived shades control its color. | **Needs validation.** Check all shapes, small sizes, fixed screen-space widths, explicit/derived colors and greyout. |
| **Images and icons** | A shared texture atlas and per-point UV rectangles provide image sampling, sizing and compositing over the shape. | **Needs validation.** Check atlas creation/updates, transparency, independent image size and shape compositing. |
| **Highlighting and greyout** | Status textures and separate drawing layers put highlighted points above greyed-out points. | **Needs validation.** Check colors, opacity, image behavior and layering. |
| **Hover, focus and outline rings** | Shader-generated circular bands surround points with configurable widths/colors and state precedence. | **Needs validation.** Check ring appearance, overlaps, per-point colors and interaction states. |
| **Custom drawing order** | Index/rank buffers control which points appear above others. | **Needs validation.** Check explicit order, ties, updates and highlighted layers. |
| **Occlusion optimization** | Opaque cores draw front-to-back with depth writes; a second pass blends edges/translucent portions against that depth. | **Needs validation.** Check identical output with optimization on/off, transparency, highlights and performance under overlap. |

## 3. Link rendering

Production links are instanced triangle strips, rather than native thin WebGL lines. Their vertex shader
reads both endpoint positions and constructs a ribbon along a straight or curved path.

| Feature | How production WebGL works | WebGPU coverage and remaining validation |
| --- | --- | --- |
| **Straight links from simulated positions** | Ribbon vertices fetch endpoints directly from the current position texture. | **Partial.** [Weighted links](#/weighted-links) draws minimal straight links from resident positions on both backends. Production ribbon geometry and visual parity remain unvalidated. |
| **Curved links** | Vertex shaders place segmented ribbons along a parameterized conic curve. | **Needs validation.** Check curve parameters, tessellation, endpoints and short/degenerate links. |
| **Widths and zoom scaling** | Per-link widths and uniforms control ribbon thickness and optional zoom scaling. | **Needs validation.** A demo's shared line width does not cover per-link values, defaults, tiny strokes or production scaling. |
| **Colors and endpoint gradients** | Per-link colors or source/target point colors feed interpolation along the link. | **Needs validation.** Minimal demo colors do not establish per-link styles, alpha rules or gradient parity. |
| **Solid, dashed and dotted styles** | Fragment shaders calculate stroke coverage and repeating patterns along the ribbon. | **Needs validation.** Check dash/gap units, dots, curves, zoom and short links. |
| **Arrowheads** | Shader calculations shape an arrow region and scale it relative to link width and length. | **Needs validation.** Check per-link enablement, sizing, curves and short-link limits. |
| **Opacity, antialiasing and blending modes** | Source-over blending produces soft edges/transparency; an optional unblended mode produces opaque hard edges. | **Needs validation.** Check both modes and production greyout behavior, not just basic link visibility. |
| **Distance-based visibility** | Shader opacity changes with the link's on-screen length. | **Needs validation.** Check visibility thresholds, minimum opacity and zoom. |
| **Highlight, hover and focus** | Status data changes greyout, hover color and extra width for hovered/focused links. | **Needs validation.** Check state combinations and agreement with picking. |

## 4. Rendering support and interaction

| Feature | How production WebGL works | WebGPU coverage and remaining validation |
| --- | --- | --- |
| **Transitions and point exits** | CPU timing supplies eased progress; GPU passes/shaders interpolate positions, point colors/sizes/strokes and link colors/widths, with exit ramps for disappearing points. | **Needs validation.** Check interrupted transitions, additions/removals, absent data and simulation interaction. |
| **Zoom, pan, fit-to-view and resize** | CPU view transforms feed shader matrices; GPU bounds reductions support fitting the layout. | **Needs validation.** Center reduction does not prove bounds reduction. Check view transforms, clipping, pixel ratios and screen/world size rules. |
| **Point and link picking** | Offscreen passes encode element IDs; reading the pointer pixel identifies the hit. Host picking uses the host's color encoding. | **Needs validation.** Check shape/image coverage, ordering, links, asynchronous readback and visible/pickable agreement. |
| **Rectangle and polygon selection** | GPU passes test point positions against selection boundaries. | **Needs validation.** Check boundary rules, coordinates, absent points and result readback. |
| **Position tracking and label sampling** | GPU passes gather selected positions or screen-space samples for CPU consumers. Example text labels are external overlays, not a built-in GPU text renderer. | **Needs validation.** Check tracking freshness, sampling, readback latency and overlay synchronization. |
| **Host rendering and shared resources** | Cosmos can draw into a host render pass with supplied view transforms, shared devices/position resources and host picking. | **Partial.** The lab demonstrates resident compute-to-render buffers and shared grid inputs. Production host ownership, deck integration, state isolation, resizing and device-loss handling still need validation. |

## 5. What the existing experiments actually establish

| Experiment | Demonstrated scope | Does not yet establish |
| --- | --- | --- |
| [Global center of mass](#/center-mass) | Blend-based WebGL aggregation versus WebGPU reduction and CPU reference | The center force or complete force order |
| [Scalable reduction](#/scalable-reduction) | Hierarchical reduction and GPU-resident results at larger counts | Cluster reductions, bounds or complete graph scalability |
| [Circle rendering](#/point-rendering) | Basic circle geometry, colors and blending on both backends | Complete point styling and interaction |
| [Spatial grid](#/spatial-grid) | Count/scan/scatter and exhaustive grid validation against CPU | Production collision or global many-body behavior |
| [Neighborhood forces](#/neighborhood-forces) | Local force traversal, numerical precision, integration and resident circle drawing | Cosmos's global repulsion, collision constraint or production integration semantics |
| [Hierarchical repulsion](#/many-body-grid) | Shared-bounds grid aggregates, selected neighbor identities, shell traversal and integration; separate exact-reference quality metrics | Full dense CPU parity, GPU bounds, adaptive sample budgets, scalable construction or convergence |
| [Global many-body](#/many-body) | Exact all-pairs force and production integration, with same-input correctness separated from independent trajectory drift | Approximate global force above 4,096 points, cross-device performance, long-term layout quality or composition |
| [Weighted links](#/weighted-links) | Ordered spring semantics, directional CSR, integration and minimal point/link drawing | Full force composition, renderer parity or native stability/performance across devices |
| [Performance lab](#/performance-lab) | Repeatable isolated rendering/reduction timing methodology | A complete-engine speedup or validation of missing features |

### Keeping this checklist useful

Move a feature to **Covered in isolation** only when a linked experiment implements its stated scope and checks
it against production behavior or a suitable reference. Keep unresolved cases in the same row. Record device,
browser, workload and numerical/visual acceptance conditions in the experiment's Markdown findings; JSON exports
remain available for local analysis. No individual row implies production readiness.

Implementation anchors for maintainers: `src/simulation.ts` (force order), `src/modules/Force*` and
`src/modules/Clusters` (forces), `src/modules/Points` and `src/modules/Lines` (rendering),
`src/modules/Transition` (animation), and `src/config.ts` (public behavior), all relative to the repository root.
