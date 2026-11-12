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

Cosmos pointer hover is a **different contract**: a downsampled circular footprint and nearest
candidate in a cursor window. Porting that tolerance and its priority/scheduling is still open.
Do not interpret this experiment as validating the complete pointer API.

## Acceptance declared before measurement

Every framebuffer pixel is checked. IDs must agree exactly between backends and against an
independent scalar shape mask. Color channels may differ by at most **2/255**, accounting for
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
It is **not** included among the 12 passing configurations:

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
not approve these configurations. Resolving this boundary is the next renderer task.

## Known failing control: global opacity zero

Production host picking tests coverage and fill alpha **before applying global `pointOpacity`**.
At global opacity zero, it still returns IDs for invisible points. The WebGPU compatibility path
preserves this behavior, and the audit reports a failure in both lanes. This is evidence of a
production contract gap, not an accepted rendering/picking match. No production fix is included.
The default shape fixture records **15,180 invisible picked pixels per backend** at ratio 1.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Point styling and picking**.
2. Compare the shapes, overlap, edge-case and fractional fixtures. Change zoom, pixel ratio and draw order.
3. Move over either canvas: both show the ID at the same normalized pixel. The UI reads the
   captured ID images; it does not issue or time a new GPU pick per pointer event.
4. Set global opacity to zero and confirm the visibility failure stays explicit. Export JSON
   to retain settings, original inputs, environment, counts and first ID, scalar-mask and color mismatches.
5. Run `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/point-styling`.

No runtime performance, picking-latency or broad device claim follows from the readback-heavy
diagnostic. Images/atlas alpha, rings/highlight priority, greyout, automatic perceptual stroke
shading, transitions, clipping of offscreen centers, occlusion optimization and host depth/picking
integration require additional fixtures before full renderer acceptance.

## Sources

- [luma texture readback](https://luma.gl/docs/api-reference/core/resources/texture): copy-source usage and explicit readback buffers.
- [luma interaction and picking](https://luma.gl/docs/api-guide/engine/interactivity): identity picking and readback costs.
- [WebGPU specification](https://www.w3.org/TR/webgpu/): render attachment formats, copies and row alignment.
- [OpenGL ES 3.0 specification, section 3.4](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf): point rasterization and point-coordinate evaluation.
