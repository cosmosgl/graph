---
source: Recorded findings
recorded: 2026-11-12
device: Apple M3; installed Chrome 157 and inline Chromium 157
scope: Twelve production-control configurations, fourteen explicit-coordinate styling cases and thirty opacity controls; separate CPU visibility rules, unchanged tolerances and preserved production failures.
---

## Question

Can a luma WebGPU quad renderer preserve Cosmos point styling and select the point actually
drawn at a pixel? This is a frozen rendering study, independent of force simulation.

## Production control

The WebGL lane imports the **unmodified** production `draw-points.vert` and `draw-points.frag`,
point-size and exit-ramp GLSL, shape geometry, OKLab and picking-color modules. luma v10 `Model`
and `UniformStore` provide resources and uniforms. Production module GLSL is loaded from its
template literal to avoid importing production luma v9 runtime/types into this v10 experiment.
This hosts the production single-pass shader; it is not the complete `Graph` runtime.

Both draw and host-pick modes use that production shader. The WebGPU lane uses luma `RenderKernel`,
storage buffers and instanced quads. One shared WGSL shape/size implementation serves color and
ID passes, with separate pipeline blending and uniform buffers. No native device handles or raw
graphics commands are used. Positions remain frozen throughout a comparison.

```flow
Shared positions, shapes, sizes, colors and draw order · Resolve the same configuration defaults
Visible draw · Shape distances, edge coverage, inset stroke, fill alpha and blending
Host picking · Same shape coverage, half-coverage threshold, original point ID, blending disabled
Readback · Compare every color and ID pixel; scalar geometry is a separate control
```

## Covered features

- Circle, square, triangle, diamond, pentagon, hexagon, star, cross and `None`.
- Per-point RGBA fill, transparent and translucent points, CSS sizes, global opacity and size scale.
- Zoom-dependent sizing and the production constant-size zoom rule, pixel ratios 1 and 2, and a
  shared 128 CSS-pixel size cap. This is a bounded cap, not a queried hardware capability claim.
- Explicit/default inset stroke colors and widths, including per-shape width clamping.
- NaN channel defaults, size zero, subpixel size, absent records, overlap and reversed render order.
  Original point identity stays stable when the draw order changes.
- A separate fractional-size/position diagnostic retains its failing parity gates.

WebGL receives NaN default sentinels as production does. Before WebGPU upload, the host resolves
them against configuration defaults; WGSL receives finite records and an explicit absence flag.
This preserves these settled styling results without depending on GPU NaN arithmetic. It does
not yet establish the production transition/default-update contract.

## Picking contract

This study checks **shape-aware host picking**, the production `renderMode = 3` pass. A shape is
picked where geometric coverage is at least one half and its resolved fill alpha is positive.
The AA fringe outside that contour can be faintly visible without being pickable; low nonzero
fill alpha does not change the contour. At overlap, the last covered point in render order wins,
including translucent points. IDs use the production 24-bit RGB encoding, with black reserved for
background. Pick targets are linear RGBA8, unblended, without multisampling or color-space conversion.

The candidate additionally requires **positive global opacity**. Its CPU rule is named `visible`;
at opacity zero it returns background, while any positive opacity keeps the geometric contour.
Production snapshots retain the `legacy` rule, which ignores global opacity. Resolved fill alpha
zero, absence, `None` and nonpositive size remain unpickable under both rules. At overlap, an
ineligible point must not block the point beneath it. The CPU makes these decisions from inputs,
not from a GPU image. Snapshot metadata selects each lane's declared rule in all comparisons.

Cosmos pointer hover is a **different contract**: a downsampled circular footprint and nearest
candidate in a cursor window. Porting that tolerance and its priority/scheduling is still open.
Do not interpret this experiment as validating the complete pointer API.

## Acceptance declared before measurement

Every framebuffer pixel is checked. IDs must agree exactly between backends and against an
independent scalar shape mask with its declared visibility rule. Color channels may differ by at most **2/255**, accounting for
RGBA8 quantization and blend evaluation. Pixels beyond this budget remain failures, including
edge cases; there is no relaxed picking-mask tolerance. Picked pixels with zero offscreen rendered
alpha are counted separately and fail the visibility check. The force experiments’ numerical
tolerances are unchanged.

Opaque isolated shapes have an additional direct check: their picked mask must equal the pixels
whose rendered alpha is at least 128/255. This compares picking with actual GPU paint rather than
only comparing two implementations of a geometry formula. It is not used as the contour rule for
translucent or overlapping shapes.

The offscreen color target clears to transparent black, so alpha measures actual emitted coverage
independently of the opaque canvas background. Both canvas and offscreen color draw use the same
data, uniforms, geometry and blend state. WebGL readback rows are flipped to the same top-left
coordinate system as WebGPU. WebGPU copies use 256-byte row alignment and luma buffer readback.

## Native M3 findings

Measured **12 November 2026**, Apple M3, installed Chrome **157** and the Codex inline Chromium
browser, pinned luma **10.0.0-alpha.4**. WebGL runs through ANGLE Metal. The native regression
matrix checks 12 configurations, **3,440,640 pixels per backend** in total:

| Fixture | Settings beyond defaults | Result |
| --- | --- | --- |
| Eight shapes, fill/stroke rows | Default; ratio 2; zoom 0.5; zoom 2; zoom 2 with constant-size rule | All five pass |
| Overlap | Default; reverse order; opacity 0.35; ratio 2 with reverse order | All four pass |
| Defaults/edge cases | Default; ratio 2; default size 54, stroke 8 and size scale 0.5 | All three pass |

All 12 have exact cross-backend IDs and scalar masks, no color pixels beyond 2/255 and no
invisible picks. The default inline view is byte-identical across both RGBA8 targets. Eight
isolated opaque shapes in each backend also pass the independent rendered-half-alpha/pick-mask
check. GPU IDs 255, 65,535 and 65,536 survive RGB carry boundaries with a 65,537-record absent
prefix fixture. That fixture tests encoding/identity; it is not a large-graph rendering benchmark.

The initial quad renderer differed at two pixels for a one-device-pixel circle at an exact edge
tie (ratio 2). GL points and triangle carrier quads selected opposite vertical edge pixels.
Expanding the carrier by one pixel and explicitly clipping/reconstructing coordinates within the
original sprite fixes this bounded case. The visible diameter, coverage ramp, color budget and
ID requirements are unchanged. Other adapters still need native validation.

### Fractional sizes and positions remain unaccepted

The separate fixture uses diameters `0.25` through `42.5` CSS px and quarter-pixel coordinates.
The rejection in this subsection applies to the **production control**. It is **not** included
among the 12 passing production configurations. The explicit-coordinate candidate follows below:

| Pixel ratio | WebGL ↔ WebGPU ID differences | Scalar mask failures, GL / GPU | Color pixels beyond 2/255 | Maximum channel difference |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2 | 2 / 0 | 27 | 21/255 |
| 2 | 0 | 6 / 6 | 46 | 10/255 |

Neither row has zero-alpha picked pixels, but both fail the declared parity contract. At ratio 1,
the first ID disagreement is pixel `(192, 254)` on the 13.3 CSS-pixel circle: WebGL returns
background, while WebGPU and the scalar geometry return point 9. At ratio 2, both backends differ
from the double-precision scalar classification at six contour pixels. Raster/point-coordinate
evaluation and boundary rounding require a separate isolation; this report does not establish a
driver violation or silently replace the scalar rule to obtain a pass.

The fractional regression checks visibility and reports the raw rejected parity result; it does
not require the same native failure on every adapter. A passing regression suite therefore does
not approve these configurations.

### Fractional mismatch isolation in the Codex inline browser

Measured **12 November 2026**, Codex inline Chromium, Apple M3 / ANGLE Metal, luma
**10.0.0-alpha.4**, default zoom, opacity and draw order. The original acceptance rules,
production shader sources and CPU mask are unchanged. The two rows above reproduce inline.

The fractional fixture now captures two unblended RGBA32F diagnostic targets through public luma
APIs: point/core coordinates and diameters, then edge distance and coverage. A copy of the production
GLSL writes these intermediates before picking; normal color/ID images still come from the
unmodified shader. The WGSL probe captures its own coordinates and coverage. Per-circle counts,
representative rejected pixels and magnified picking masks stay visible below the live audit.

**Cause 1: WebGL's point-coordinate field differs from analytical pixel coordinates.** Only point 9,
the 13.3 CSS-pixel circle, exceeds the color budget in this fixture. Both GPUs receive a
float32 diameter of `13.300000190734863` at ratio 1, so the large difference is not explained by
uploading the decimal size as float32. Fitting neighboring captured coordinates gives:

| Pixel ratio | Intended device diameter | WebGL coordinate span, x / y | WebGPU coordinate span, x / y |
| --- | ---: | --- | --- |
| 1 | 13.3 | 13.250000 / 13.250000 | 13.299999 / 13.300000 |
| 2 | 26.6 | 26.625008 / 26.625008 | 26.599999 / 26.599999 |

These are measured coordinate-field fits, not hardware capability queries or a portable rounding
law. At ratio 1, pixel `(192, 254)` has CPU signed edge distance `−0.007334872` px. WebGPU reports
`−0.007334780` with coverage `0.511001`; WebGL reports `+0.047850687` with coverage `0.428443`.
That puts the pixel on opposite sides of the unchanged half-coverage picking threshold. Its
rendered alpha is `109/255` in WebGL and `130/255` in WebGPU.

An explicit **diagnostic control**, separate from the production lane, replaces only
`2 * gl_PointCoord − 1` in a shader copy with coordinates reconstructed from `gl_FragCoord`, a
flat projected center and the existing sprite diameter. Shape formulas, size, color, blending,
picking threshold and CPU reference remain the same. Its full-frame comparison with WebGPU is:

| Pixel ratio | ID differences | CPU mask failures, control GL / GPU | Color failures | Maximum channel error | Overall gate |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 0 | 0 / 0 | 0 | 0/255 | Pass for the diagnostic control |
| 2 | 0 | 6 / 6 | 0 | 0/255 | Fail |

This isolates the observed cross-backend ID/color disagreement to the coordinate path. It does
not accept the original production rendering or establish a driver violation. The captured
coordinate field and its limits can differ on another adapter.

**Cause 2: sprite boundaries and the existing CPU mask disagree at exact ties.** At ratio 2,
three circles have device diameters 2, 4 and 6. Their top and right cardinal pixels lie exactly
on the closed CPU circle. Both GPU sprites omit those pixels; the float probe contains no fragment
there. The six rejected coordinates are `(630, 120)`, `(631, 121)`, `(130, 319)`, `(132, 321)`,
`(630, 318)` and `(633, 321)`. This is a raster-footprint boundary before shape-distance evaluation,
not accumulated SDF arithmetic error. The analytical-coordinate control cannot recover a
fragment that the point sprite did not generate.

The WebGPU carrier currently reproduces the observed half-open sprite bounds (left/bottom
included; top/right excluded). The scalar mask includes all four exact boundaries. Both are
retained and the six differences remain failures. Changing the CPU rule would change the
acceptance contract; it is not part of this investigation.

The follow-up below tests an explicit-coordinate candidate while keeping these original
controls and their failures intact.

### Explicit-coordinate renderer with closed coverage

Measured **12 November 2026**, **Codex inline Chromium / Apple M3**, luma **10.0.0-alpha.4**.
Both candidate backends use six-vertex instanced quads, with one device pixel of carrier padding
on each side. The WebGL candidate copies the production styling shader and substitutes
pixel coordinates reconstructed from `gl_FragCoord` and a flat projected center. luma `Model`
provides instancing; the WebGPU candidate uses the existing luma `RenderKernel` and an explicit
closed-bounds mode. Production sources and the default production mode remain unchanged.

The carrier includes boundary fragments; the fragment shader clips to the original closed sprite
square. It does **not** increase the requested diameter or change shape distances, the antialiasing ramp,
stroke width, alpha, draw order or the half-coverage picking threshold. No epsilon, excluded pixels,
CPU-mask edit or larger color budget is used. The previously omitted top/right pixels can now
execute the same shape-distance test as the other pixels.

| Fractional fixture | ID differences | CPU mask failures, explicit GL / GPU | Color failures | Maximum channel error | Invisible picks | Candidate geometry |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ratio 1 | 0 | 0 / 0 | 0 | 0/255 | 0 / 0 | Pass |
| Ratio 2 | 0 | 0 / 0 | 0 | 0/255 | 0 / 0 | Pass |

All six original ratio-2 omissions return the CPU's expected point ID in both candidate backends:
point 2 at `(630, 120)` and `(631, 121)`; point 4 at `(130, 319)` and `(132, 321)`; point 6 at
`(630, 318)` and `(633, 321)`. Their rendered alpha is **128/255 in both backends**, agreeing with
the half-coverage pick. The live **Six boundary pixels** table replays these against the original
production images. It is an explanation, not a filtered acceptance population.

The candidate also passes the previous **12 styling configurations** at the same full-frame gates,
giving **14 bounded cases and 4,259,840 checked pixels per backend** in that matrix. Isolated opaque
instances of all eight shapes retain the additional equality between their picked masks and
rendered alpha ≥ 128/255. Returning to production mode reproduces the original images; the
candidate does not overwrite the control.

**Legacy compatibility still fails on the fractional fixture.** Closed coverage emits samples
that the production point sprite omitted, including antialiased fringe samples. Comparing
production WebGL directly with explicit WebGPU, using the original gates, records:

| Pixel ratio | ID differences | CPU mask failures, production / candidate | Color failures | Maximum channel error | Compatibility |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 2 | 2 / 0 | 61 | 127/255 | Fail |
| 2 | 6 | 6 / 0 | 63 | 128/255 | Fail |

These do not become passing legacy results. The candidate demonstrates agreement with the
unchanged intended geometry on this bounded M3 matrix. Adopting the closed boundary behavior
would be an intentional rendering change from the current production sprite. Other devices,
broader geometry and performance remain unvalidated; this is not a complete renderer migration.
That initial candidate retained the zero-opacity failure. The visibility-aware follow-up below
corrects it without changing the geometric contour or tolerances.

## Known failing control: global opacity zero

Production host picking tests coverage and fill alpha **before applying global `pointOpacity`**.
At global opacity zero, it still returns IDs for invisible points. The WebGPU compatibility path
preserves this behavior, and the audit reports a failure in both lanes. This is evidence of a
production contract gap, not an accepted rendering/picking match. No production fix is included.
The default shape fixture records **15,180 invisible picked pixels per backend** at ratio 1.

### Candidate visibility rule and opacity matrix

Measured **12 November 2026**, **Codex inline Chromium / Apple M3**, luma **10.0.0-alpha.4**.
The explicit candidate now discards its ID fragment when global opacity is zero. In GLSL this
guard lives only in the candidate shader copy. WGSL enables it only for explicit-candidate mode.
Color rendering, production shaders/mode, shape distances, the half-coverage threshold, exact-ID
checks and the **2/255** color budget are unchanged. No low-alpha cutoff or epsilon is introduced.

This is an explicit **visibility-reference update**, not a tolerance adjustment: `visible` applies
the requested opacity rule; `legacy` retains the original CPU rule for the unchanged production
control. Cross-backend IDs still have to agree exactly. A mixed legacy/candidate comparison
checks each lane against its own declared CPU rule, reports both expected IDs at a mismatch, and
continues to fail if actual IDs differ. Different reference roles do not make legacy picking
compatible with candidate picking.

The opacity matrix checks five fixture/order cases at pixel ratios 1 and 2, with opacity
**0, 0.35 and 1**: **30 configurations and 12,288,000 pixels per backend**. The cases are eight
shapes with fill/stroke rows, overlap in normal and reversed order, defaults/edge cases, and
fractional sizes/positions.

| Opacity | Candidate result across 10 fixture/ratio cases | Picking and visibility |
| --- | --- | --- |
| 0 | All pass | Entire color and ID images are zero; no painted, picked or invisible-picked pixels |
| 0.35 | All pass | Exact CPU masks and cross-backend IDs; colors within 2/255; no invisible picks |
| 1 | All pass | Same ID images as opacity 0.35, with the same gates passing |

The previous 14-case styling matrix, isolated opaque paint/pick checks, boundary replay and
production-state restoration also pass. The complete focused suite has **14 passing tests in the
Codex inline browser**. Production mode is rechecked at opacity zero after candidate runs: it
still returns invisible IDs and fails visibility. The six recovered boundary points become
background in the candidate at opacity zero and retain their expected IDs at positive opacity.

The live audit shows painted/picked pixel counts and names the active CPU rule. JSON schema 4
includes each comparison's `pickingRules` and per-lane expected IDs in mismatch samples. These
measurements are local exports; they are not stored in the repository.

This closes the bounded **zero-global-opacity** case. Arbitrarily tiny positive alpha, display
quantization, image-atlas alpha and broader device coverage remain separate validation work.
The strict zero-rendered-alpha audit still rejects any such invisible pick; there is no waived
visibility failure for inputs outside this matrix. Fractional legacy coverage differences also
remain intentional, reported compatibility failures.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Point styling and picking**.
2. Compare the shapes, overlap, edge-case and fractional fixtures. Change zoom, pixel ratio and draw order.
   Select **Renderer → Explicit-coordinate candidate** to compare padded WebGL/WebGPU quads.
   The main audit checks candidate geometry; the separate production control retains legacy failures.
   Use ratio 2 on the fractional fixture to inspect **Six boundary pixels**.
3. Move over either canvas: both show the ID at the same normalized pixel. The UI reads the
   captured ID images; it does not issue or time a new GPU pick per pointer event.
4. Test opacity **0**, **0.35** and **1**. At zero, the candidate must paint and pick no pixels;
   production must retain its failed visibility control. At positive opacity, the pick contour
   stays unchanged. Export JSON to retain settings, CPU rule names, environment and raw mismatches.
5. Run `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/point-styling`.

For the same regression suite **inside Codex**, set `LAB_INLINE_BROWSER=1` as well. This starts
a local Vitest server without launching Chrome. Open its printed “inline test session” URL in
the Codex inline browser; the suite runs in that browser, including both GPU backends. The
regression checks that enabling probes preserves production images and counts, that the earlier
coordinate-only control retains its closed-mask failures, and that the padded candidate recovers
the boundary pixels at unchanged full-frame gates. JSON exports name the renderer and include
candidate geometry/visibility, original production and compatibility verdicts; raw measurements remain local.

No runtime performance, picking-latency or broad device claim follows from the readback-heavy
diagnostic. Images/atlas alpha, rings/highlight priority, greyout, automatic perceptual stroke
shading, transitions, clipping of offscreen centers, occlusion optimization and host depth/picking
integration require additional fixtures before full renderer acceptance.

## Sources

- [luma texture readback](https://luma.gl/docs/api-reference/core/resources/texture): copy-source usage and explicit readback buffers.
- [luma interaction and picking](https://luma.gl/docs/api-guide/engine/interactivity): identity picking and readback costs.
- [WebGPU specification](https://www.w3.org/TR/webgpu/): render attachment formats, copies and row alignment.
- [OpenGL ES 3.0 specification, section 3.4](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf): point rasterization and point-coordinate evaluation.
