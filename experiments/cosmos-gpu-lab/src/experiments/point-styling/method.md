---
source: Recorded findings
recorded: 2026-11-13
device: Apple M3; installed Chrome 157 and inline Chromium 157
scope: Source-byte picking passes 32 visibility cases, 24 styling controls and 767 alpha samples per backend on M3. Color bytes are preserved, including the 64-point faint stack; prior controls and acceptance gates remain unchanged.
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

The earlier explicit-coordinate candidate additionally requires **positive global opacity**. Its CPU rule is named `visible`;
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

## Tiny positive alpha and source visibility

Measured **13 November 2026**, **Codex inline Chromium / Apple M3**, luma **10.0.0-alpha.4**.
The zero-opacity fix remains valid within its recorded matrix. Positive shader alpha, however,
does not guarantee a nonzero RGBA8 alpha byte. The new fixtures expose two distinct problems:

- **Tiny-alpha grid:** 15 isolated circles, with CSS diameters **1/64, 1/8, 0.5, 2 and 42**
  across columns and fill alpha **1, 1/255 and 1/65536** across rows. Pixel-aligned and fractional
  centers exercise minimum-size attenuation and partial coverage.
- **Tiny-alpha overlap:** a 42-pixel foreground circle with fill alpha **1/65536**, over an
  opaque 90-pixel circle. This asks whether the selected point contributes paint, rather than
  merely whether some point has painted that pixel.

The repeatable sweep runs both fixtures at ratios **1 and 2**, with global opacity **0, 0.0001,
0.49/255, 0.5/255, 0.51/255, 1/255, 0.35 and 1**: **32 configurations**. Each compares the
production/legacy pair and the explicit/visible pair. Exact CPU masks, exact cross-backend IDs,
the **2/255** color budget and zero-alpha visibility requirements remain unchanged. No shader
cutoff, reference eligibility update or relaxed gate is introduced in this investigation.

### Results

**Only the four zero-opacity candidate rows pass all applicable checks; 28 rows fail.**
All 32 candidate rows nevertheless have exact cross-backend IDs and CPU masks, with no color
budget failures. The largest color-channel difference is **1/255**. Matching implementations
can therefore still select an invisible point.

| Fixture and global opacity | Ratio | Painted pixels per backend | Invisible picks per backend | Candidate result |
| --- | --- | --- | --- | --- |
| Isolated grid, 0 | 1 / 2 | 0 / 0 | 0 / 0 | Pass |
| Isolated grid, 0.0001 | 1 / 2 | 0 / 0 | 4,154 / 16,653 | Fail |
| Isolated grid, 0.5/255 | 1 / 2 | 1,314 / 5,392 | 2,840 / 11,261 | Fail |
| Isolated grid, 1 | 1 / 2 | 2,857 / 11,219 | 1,385 / 5,558 | Fail |
| Faint foreground over opaque background, 1 | 1 / 2 | Background remains painted | 1,396 / 5,544 foreground picks have zero own alpha | Fail |

WebGL and WebGPU have the same counts in this table. The paired values separated by `/` are
**ratio 1 / ratio 2**, not different backends. The live sweep and local JSON export retain every row.

One small example explains the isolated failure. At ratio 1, global opacity 1 and pixel **(50, 60)**,
point **0** is a circle of diameter **1/64 CSS pixel** with opaque fill. Cosmos keeps a minimum
one-pixel core and attenuates its ink by the area ratio: **(1/64)² = 1/4096**. At this centered
pixel, the geometry passes the picking threshold, while the rendered alpha byte is zero.
This is a measured RGBA8 storage result, not a claim that every adapter rounds boundary ties
identically.

### Why composed-frame alpha is insufficient

At ratio 1 and opacity 1, the overlap fixture passes the existing full-frame audit: exact IDs,
exact CPU masks, equal color images and nonzero composed alpha. Both backends select foreground
point **1** at **1,396 pixels**. Rendering that point alone through the same pipeline yields
zero alpha at every selected pixel. Removing it from the composition changes **zero RGBA pixels**.
The first example is **(251, 139)**: own alpha **0**, composed alpha **255/255**. Ratio 2 has
**5,544** such picks and still zero color changes after removal.

The new **Picked-point contribution** diagnostic reports this separately. Six overlap rows
(opacities **1/255, 0.35 and 1**, at both ratios) pass the composed-frame checks but fail the
source check. The page's current result and sweep acceptance include this failure, so a painted
background cannot produce an overall Pass for an invisible foreground.

This is diagnostic isolation for a two-point fixture, not a proposal to render each production
point separately. Isolated alpha and removal deltas answer different questions: overlapping faint
sources may accumulate, and an opaque foreground can conceal a source beneath it. These fixtures
demonstrate concrete failures; they do not establish a complete general compositing policy.

### Approaches checked against the specifications

| Approach | Assessment for Cosmos |
| --- | --- |
| Require positive input alpha/opacity | Current candidate policy; insufficient after size attenuation, coverage and RGBA8 conversion |
| Read final composed alpha during picking | Cannot solve the measured opaque-background case: composed alpha is already 255 |
| Add a configurable alpha cutoff | An established interaction policy, but an arbitrary cutoff would change which faint points are pickable |
| Render into a floating-point target | Can retain smaller source values, but does not by itself establish final-display visibility or correct source identity |
| Share effective source alpha and an explicit format-aware eligibility rule | Best next prototype; must be a declared candidate/reference policy and tested at conversion ties and overlaps |

[deck.gl IconLayer](https://deck.gl/docs/api-reference/layers/icon-layer#alphacutoff-number-optional)
uses an alpha cutoff (default **0.05**) to create holes excluded from picking. This confirms that
cutoff selection is an interaction contract. It does not justify importing a 5% cutoff into Cosmos.

The [WGSL `pack4x8unorm` definition](https://www.w3.org/TR/WGSL/#pack4x8unorm) provides an explicit
8-bit packing model: `floor(0.5 + 255 * clamp(alpha, 0, 1))`. This can inform an application-defined
quantizer shared by color, picking and CPU reference. It is **not** a guarantee that a WebGL
render attachment performs that exact rounding. [OpenGL ES 3.0, §2.1.6.2](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)
permits either neighboring integer for normalized conversion and prefers nearest rounding.
The **0.5/255** neighborhood therefore needs native tests; it is not a portable assumed cutoff.

Higher precision also changes the storage experiment. In particular, blending with `rgba32float`
requires the optional [WebGPU `float32-blendable` feature](https://www.w3.org/TR/webgpu/#float32-blendable).
Neither that feature nor a higher-precision target is required by this RGBA8 study.

**Follow-up:** prototype a shared effective source alpha calculation, including shape coverage,
subpixel area attenuation, resolved fill alpha and global opacity. Intersect the existing
geometric half-coverage contour with an explicitly declared source-byte eligibility policy.
If quantizing explicitly, keep color and picking coherent rather than guessing framebuffer
rounding only in the ID pass. Preserve the current candidate and production controls; compare
the new policy with the unchanged exact-ID and color budgets. The follow-up below implements and tests this proposed policy as a separate candidate. Image-atlas alpha follows once this source-visibility policy is established.

## Shared source-alpha quantization candidate

Measured **13 November 2026**, **Codex inline Chromium / Apple M3**, luma **10.0.0-alpha.4**.
This is a third selectable renderer, **Source-alpha quantized candidate**. Production GLSL and
the earlier explicit candidate remain controls; their failures are retained. Resource creation,
instanced rendering, submission and readback continue through public luma APIs.

### One alpha value for color and picking

The candidate calculates effective source alpha after shape coverage, subpixel ink attenuation,
resolved fill alpha and global opacity, with the same multiplication grouping in both shaders:

```text
a = coverage × (min(1, diameter² / core²) × fillAlpha) × globalOpacity
q = floor(0.5 + 255 × clamp(a, 0, 1))
color alpha = q / 255
pick eligible = original half-coverage geometry AND q > 0
```

The value is computed once per fragment and used by both modes. A zero-byte foreground cannot
overwrite a visible point's ID. The geometric half-coverage contour, antialiasing ramp, requested
diameter, RGB/stroke calculation, blend state, draw order and RGBA8 target are unchanged. Faint
fringes outside the geometric contour can still paint without being pickable.

| Renderer | CPU rule | Eligibility |
| --- | --- | --- |
| Production control | `legacy` | Original shape/fill-alpha rule, including its global-opacity gap |
| Explicit-coordinate candidate | `visible` | Closed geometry and positive global opacity; retained unchanged |
| Source-alpha quantized candidate | `source-alpha` | Same geometry intersected with a nonzero source byte |

The new CPU rule is explicit, not a tolerance change or a replacement of the old controls.
It independently evaluates scalar coverage from inputs and rounds source multiplication and
uploaded alpha/opacity to float32. It never reads a GPU mask to determine expected IDs. Every
frame still requires exact cross-backend IDs, exact IDs against its declared CPU rule, colors
within **2/255**, and no invisible picks. Production compatibility remains a separate comparison
and can fail even when the candidate passes.

This intentionally changes candidate alpha before blending. It is a proposed RGBA8 rendering
policy, not proof that legacy picking already obeys it or that the production library has migrated.

### Why the shaders use integer packing

The rounding policy follows the mathematical [WGSL `pack4x8unorm` definition](https://www.w3.org/TR/WGSL/#pack4x8unorm).
Writing its formula naively in float32 introduces an extra rounding step. For example,
`a = 0.0019607841968536377` is the float32 immediately below the first byte threshold:
`255 × a = 0.4999999701976776`. Adding `0.5` in float32 rounds to **1**, although the required
byte is **0**. This would wrongly make the lower neighbor pickable.

The two candidate shaders instead extract the float32 significand/exponent and multiply the
significand by **255** in 32-bit unsigned arithmetic. The product fits: its maximum is
**4,278,189,825**, below 2³². Reading the quotient and rounding bit separately avoids an overflowing
rounding-bias addition. GLSL uses explicit `highp uint`; no optional 64-bit arithmetic is required.
The independent CPU quantizer uses JavaScript double arithmetic on the float32 source value.

This also avoids relying on GLSL `round` tie direction, which is implementation-dependent in
the [GLSL ES 3.00 specification, §8.3](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
It defines the application's source-byte policy; it does not assert a universal framebuffer
rounding rule for WebGL or silently change the target to a floating-point format.

### Native validation

The quantizer test renders **767 isolated samples per backend**: every one of the **255** byte
boundaries, the nearest float32 and both neighboring float32 values, plus alpha **0 and 1**.
Readback alpha bytes match the independent CPU quantizer exactly. IDs select the sample exactly
when its byte is nonzero. The lower neighbor of the first threshold stays unpickable; its nearest
float32 and upper neighbor remain pickable. This checks that the fix does not simply discard all
faint points.

The bounded styling matrix adds **24 configurations**: shapes, overlap, defaults/edge cases and
fractional geometry, at ratios **1 and 2** and opacities **0, 0.35 and 1**. All pass the unchanged
frame gates. Colors also stay within **2/255** of the unquantized explicit renderer in each API.
Returning to production or explicit mode after quantized draws retains the faint foreground's
original ID and declared CPU rule.

The full **32-case tiny-alpha sweep passes in the quantized candidate**: exact CPU masks and
cross-backend IDs, no zero-alpha picks, no color-budget failures, and maximum cross-backend
channel difference **1/255**. Both isolated-source audits also pass for all overlap rows.

| Fixture and opacity | Ratio 1 / ratio 2 | Quantized result |
| --- | --- | --- |
| Isolated grid, 0.0001 | Painted 0 / 0; picked 0 / 0 | Pass; positive input alpha cannot produce ghost IDs |
| Isolated grid, 1 | Painted 2,857 / 11,219; picked 2,769 / 11,095 | Pass; all selected pixels have nonzero paint |
| Faint foreground over opaque background, 1 | Foreground picks 0 / 0; selected center ID is background point 0 | Pass; zero-byte foreground cannot block the visible point |

The previous explicit candidate still rejects **28 of 32** rows. In particular its overlap case
retains **1,396 / 5,544** invisible foreground picks, while the new candidate has **0 / 0**.
Removing that foreground changes zero color pixels in both candidates. Recorded comparison and
source-audit summaries for **both retained controls match the preceding sweep in all 32 rows**,
including their first failures. This is a bounded visibility-policy result, not retroactive
production compatibility or broad device acceptance.

The original suite and the new checks cover **22 distinct tests** in the inline browser. After
correcting the UI's CPU-rule label, the affected **6 GPU/UI tests** pass in the final targeted
rerun. The later live-audit responsiveness changes also pass all **3 UI regression tests**.
Cancellation retains completed rows and the selected renderer/settings/canvas dimensions.
The exported **schema 6** includes the quantization policy/version, renderer and CPU rule names,
all three variants' verdicts and source audits, and the frozen reproduction inputs. Raw JSON
measurements remain local.

### Dense overlap rejects production color compatibility

A separate stress fixture, **Faint overlap stack · 64 points**, places **64 white circles** at
the same center with fill alpha **0.51/255**, ratio 1 and global opacity 1. This tests whether
pre-blend quantization preserves accumulation beyond the two-point overlap control.

| Comparison | ID differences | Color failures beyond 2/255 | Maximum channel difference | Invisible picks, left / right |
| --- | --- | --- | --- | --- |
| Production WebGL ↔ compatibility WebGPU | 0 | 0 | 0/255 | 50 / 50 |
| Quantized WebGL ↔ quantized WebGPU | 0 | 0 | 0/255 | 0 / 0 |
| Production WebGL ↔ quantized WebGPU | 50 | 1,321 | **59/255** | 50 / 0 |

Both production controls also retain two scalar-mask differences each; the quantized candidate
has none. These remain reported failures. The color change is independently isolated: production
WebGL and compatibility WebGPU are byte-identical in color, while quantized WebGPU fails the
same **2/255** budget at **1,321 pixels**. At the first such pixel, **(252, 140)**, production
RGBA is **[6, 6, 6, 6]**, versus **[64, 64, 64, 64]** after source quantization. The invisible
edge IDs are removed, but faint sources accumulate differently when rounded before blending.

**The candidate therefore fails production color compatibility and is not an adoption recommendation.**
The 32 visibility passes remain valid within their scope; they do not waive this additional
measured failure. The live status names the failed color budget near the graph, with the full
production comparison below. This adapter-specific control is recorded rather than asserted
as a required failure on every GPU.

### Boundary of this result

The demonstrated contract is nonzero **own source alpha**, not perceptual contrast against every
background. Different nonzero sources can still quantize to the same composed color, while many
faint sources could accumulate if a different rendering policy retained them. Quantizing every
source before blending changes that accumulation intentionally. Broader geometry, dense overlap,
other adapters, runtime GPU cost and image/atlas sampling still need validation. No picking-latency
or performance improvement is claimed by this readback-heavy diagnostic.

Next, test source-byte **picking eligibility while preserving the original color accumulation**.
Retain these quantized and production controls and apply the same full-frame, isolated-source and
threshold checks. The follow-up below tests that alternative without accepting a new tolerance or universal
driver-rounding assumption. Then validate image-atlas alpha, transparent texels and overlap order, alongside
per-fragment GPU cost and broader native coverage.

## Source-byte picking with original color blending

Measured **13 November 2026**, **Codex inline Chromium / Apple M3**, luma **10.0.0-alpha.4**.
The fourth renderer, **Source-byte picking candidate**, keeps the original unquantized color
alpha and blend state. Only the ID pass applies the already-declared `source-alpha` CPU policy.
The production, explicit-coordinate and pre-blend-quantized variants remain separate controls.

```text
Color pass:   original coverage, subpixel ink, fill alpha and global opacity → original blending
Picking pass: effective source alpha → nearest UNORM8 byte → require half coverage AND a nonzero byte
Both passes:  retain shape distances, carrier bounds and draw order
```

The source-byte calculation and tie rule are unchanged from the quantized control. The GPU color
path does not write `q / 255` or discard fragments based on that byte. This preserves how faint
sources accumulate while preventing a mathematically zero-byte source from replacing another
point's ID. The CPU oracle remains independent of GPU images and uses the same `source-alpha`
rule already declared for the preceding candidate. There is no new epsilon or reference-policy
adjustment in this follow-up.
Picking retains the earlier candidate's declared float32 multiplication grouping; the color
expression remains original rather than assuming that reassociation is byte-identical.

The distinction follows the [WebGPU blend-state definitions](https://www.w3.org/TR/webgpu/#blend-state):
`src-alpha` and `one-minus-src-alpha` use the alpha actually emitted by the fragment shader.
Changing that output changes color accumulation. Keeping the source byte inside picking retains
the original color inputs to blending. The [WGSL packing rule](https://www.w3.org/TR/WGSL/#pack4x8unorm)
still defines the explicit eligibility policy; it does not establish a universal WebGL framebuffer
conversion rule. Actual native paint remains part of validation.

### What is preserved and what changes

| Property | Source-byte picking candidate |
| --- | --- |
| Source RGB, alpha and source-over blend factors | Original unquantized values/state |
| Shape distances, stroke, requested size and AA ramp | Unchanged |
| Sprite geometry | The earlier explicit candidate's padded carrier and closed bounds |
| ID eligibility | Same half-coverage geometry, with a nonzero computed source byte |
| Production shaders and `legacy` CPU rule | Retained unchanged as controls |
| Existing acceptance gates | Exact IDs/CPU masks, color budget 2/255 and zero invisible picks |

The new **Original color output** table additionally checks **byte identity** against the
unquantized explicit-coordinate control separately in each API. This is a stricter preservation
check for this candidate, not a relaxation of the existing budget. It isolates the alpha-policy
change from the known production point-sprite versus closed-quad raster differences. Passing it
does not turn those older production compatibility failures into passes.

### Native results

All **25 focused tests pass in one complete Codex inline-browser run**. The new checks cover:

- **767 alpha samples per backend:** all 255 byte boundaries, their nearest float32 values and
  both neighbors, plus 0 and 1. IDs match the declared byte policy; each selected sample has
  nonzero actual paint. Every color byte matches the unquantized control.
- **24 styling configurations:** four fixture families × ratios 1/2 × opacities 0/0.35/1. The
  unchanged full-frame CPU/GPU gates pass, and every color byte is preserved in each backend.
- **Faint foreground over opaque background:** the invisible foreground is unpickable and
  center picking returns background point 0. Both isolated-source audits pass.
- **64-point faint stack:** full-frame CPU/GPU acceptance and original color preservation pass.
  Returning to each of the three retained variants after eligibility draws restores its exact
  color and ID images. Their known failures are not overwritten by the new candidate.

The **32-case tiny-alpha sweep passes completely** in the source-byte candidate. There are
**zero cross-backend ID differences, zero CPU-mask failures and zero invisible picks**. Maximum
cross-backend color-channel difference is **1/255**, within the unchanged 2/255 budget. Across all
32 rows, both APIs also have **zero changed color pixels** relative to their unquantized explicit
controls. The own-source overlap audits pass at both pixel ratios.

All recorded comparisons, source audits and verdicts for the **three retained variants match the
preceding sweep in every row**. The earlier explicit candidate still rejects 28 rows; pre-blend
quantization still passes this bounded matrix while retaining its separate accumulation failure.

The **64-point faint-stack replay** resolves the previous color-accumulation failure:

| WebGPU variant compared with production WebGL | Color pixels beyond 2/255 | Maximum channel difference | Invisible picks in this variant |
| --- | --- | --- | --- |
| Compatibility control | 0 | 0/255 | 50 |
| Pre-blend quantized control | 1,321 | 59/255 | 0 |
| Source-byte picking candidate | **0** | **0/255** | **0** |

Both source-byte backends paint and pick **1,321 pixels**, with exact cross-backend color/ID images
and CPU masks. The original color-preservation audit has **zero changed pixels in each API**.
At the preceding control's first failed pixel, **(252, 140)**, the new candidate keeps production
RGBA **[6, 6, 6, 6]**, rather than the quantized control's **[64, 64, 64, 64]**.

Whole production picking compatibility still fails: its **50 invisible IDs** and **two scalar-mask
mismatches** remain visible, while the source-byte candidate has no CPU-mask failures. These are
retained legacy failures, not waived acceptance gates or a claim of identical production picking.

### Reproduction and remaining scope

Select **Source-byte picking candidate**, then **Tiny-alpha overlap**, opacity **1**. Compare
**Original color output**, **Picked-point contribution** and the retained production comparison.
Run **Run tiny-alpha sweep** for the 32 cases, then select **Faint overlap stack · 64 points** at
ratio **1**, opacity **1** to replay the accumulation failure and correction. The latter is a
separate stress case, not part of the 32-row matrix.

Export **schema 7** records the selected renderer/policy, byte-level color-preservation counts,
all four variants' sweep verdicts and source audits, device/browser and frozen inputs. Completed
rows survive cancellation. Raw JSON stays local; the repository retains findings and reproduction
instructions. The native regression command remains the one below, with `LAB_INLINE_BROWSER=1`
when running inside Codex.

This is bounded shape-aware host picking on one native device. It does not establish universal
RGBA8 conversion behavior, perceptual contrast, full pointer-hover behavior or all production
raster compatibility. Image/atlas alpha, rings/greyout, transitions, broader native coverage
and GPU cost remain open. The next feature investigation is image-atlas alpha and transparent
texel/overlap picking with these controls and the same acceptance gates.

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
6. Select **Tiny-alpha grid** with opacity **0.0001**, then **Tiny-alpha overlap** at opacity **1**.
   Inspect both the frame audit and **Picked-point contribution**. The latter must report the
   invisible selected foreground even when the composed-frame audit passes.
7. Choose **Run tiny-alpha sweep** in Diagnostics for all 32 rows. It uses offscreen draws and
   preserves the selected settings and live canvas dimensions. CPU mask evaluation yields between
   small row chunks to service input. **Cancel sweep** finishes the current configuration and
   retains completed rows. Export JSON for environment, frozen point inputs/settings, rule names, first invisible
   samples, frame verdicts and isolated-source audits. Schema **7** includes all four variants, their policy/version and color-preservation counts;
   raw measurements remain local, outside the repository.
8. Select **Source-alpha quantized candidate**, then rerun the same fixtures and sweep. Compare its
   verdict with the explicit renderer in **Retained controls**. The source-alpha policy must pass all
   32 local cases; the original explicit candidate retains its 28 failed rows. Use the focused
   quantizer test for all byte thresholds and their neighboring float32 values.
9. Select **Faint overlap stack · 64 points**, ratio **1**, opacity **1** and the quantized renderer.
   Inspect **Production control and compatibility**: the candidate's paired frame passes, while
   the production color comparison fails its original 2/255 budget on M3. Export this separate
   control with its 64 frozen inputs; it is not included in the 32-row tiny-alpha matrix.
10. Select **Source-byte picking candidate** and repeat the sweep and 64-point replay.
    **Original color output** must show zero changed pixels in each backend. The retained
    production comparison still rejects its original invisible IDs; the new source-byte frame
    and its CPU rule must pass without changing the color budget.

For the same regression suite **inside Codex**, set `LAB_INLINE_BROWSER=1` as well. This starts
a local Vitest server without launching Chrome. Open its printed “inline test session” URL in
the Codex inline browser; the suite runs in that browser, including both GPU backends.
The initial tiny-alpha stage has **19 passing focused tests in the Codex inline browser**, including quiet-draw restoration, partial
sweep cancellation, the invisible-foreground counterexample and its visible failed result. The
chunked CPU audit returns the same complete result as the synchronous audit. The
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
