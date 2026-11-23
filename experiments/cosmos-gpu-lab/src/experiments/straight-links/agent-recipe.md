# Replaying the archived straight-link studies

The active solid-link suite shares its seven cases with the page. Run it from the repository root with
`pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links/links.test.ts`.
The diagonal checks compare WebGL, WebGPU and the CPU color reference, and compare IDs against the
geometric ribbon. Count differences within one device pixel of its sides, ends and corners separately.

The commands and run records below describe retired diagnostics. Run them in a separate
checkout of `466da466b3d83b36f6d4295939822e724dd87d35`, the last revision before
the tests were removed. Install that revision's dependencies with `pnpm install --frozen-lockfile`
and build the WebGL control with `pnpm run build` from its root. This revision provides the
replay harness. The original environments and measured results for each study are recorded below.

On the current tree, the Straight-link page compares six presets. The sweep, exports and
cap/coverage replay controls described below belong to the archived revision.
The source-visibility check now inspects every picked link, and mixed strokes use the straight analytic picking
rule. A run with these changes is a new result. For first-slice acceptance use the integrated
viewer checks described in the [Lab README](../../../README.md#webgpu-migration-checks).

## Archived investigation

Further exact-edge and pattern investigation is **parked for the first migration**,
not resolved. Solid straight links remain part of the integrated first slice.
Reopen if its rendering or picking violates the practical rules; review retained
failures before full readiness. Historical verdicts and reproduction steps below
remain unchanged. See [first-migration rules](#/validation-workflow?section=first-migration-rules)
and the [parked register](#/roadmap?section=parked-investigations).

## Theoretical follow-up · 17 November 2026

**The most useful next investigation is the interaction between interpolated
coverage and the hard `0.5` cutoff, with cap rasterization investigated
separately.** Source and specification review also found an independent GLSL
portability defect: the production stroke calls `smoothstep` with descending
edges. This original source review added hypotheses and experiment designs, not
a renderer change or a new GPU verdict. The M3 measurements cited here are
the existing replays below; the short-link example is a mathematical
counterexample, not a GPU capture.

For a focused, interactive comparison and its later M3 result, see
[Why a line edge changes](#/smoothstep-coverage).
That focused study is closed with its evidence recorded; this broader
straight-link investigation remains parked.

### Assumptions and pipeline

This analysis concerns the frozen, straight, solid, single-sample ribbons in
the study, with finite endpoints, positive zoom and DPR, and no arrows, patterns,
gradients or transitions. It does not assume pixel-exact equivalence is a WebGPU
requirement. The color pass uses the production vertex and fragment shaders on
WebGL and their lab port on WebGPU; the visible-footprint ID pass is a separate
candidate, not production's five-CSS-pixel padded picking policy.

The vertex shader extrudes a triangle-strip carrier to the stroke width plus one
device-pixel ramp. The triangle rasterizer first decides whether a fragment
exists. For each generated fragment, the shader interpolates `pos.y`, computes
transverse coverage, and in hard mode discards below `0.5`. The carrier stops at
the endpoints: straight butt caps receive no longitudinal extension or fade.
Consequently a missing cap fragment and a wrong hard-coverage decision require
different probes. A fragment shader alone cannot recover a fragment the
rasterizer did not generate.

### 1. Defined shader arithmetic is the first control

In `src/modules/Lines/draw-curve-line.frag`, the solid-stroke expression is
`smoothstep(0.5, 0.5 - smoothing, abs(pos.y))`; the arrow body has another
descending-edge call. With positive smoothing, the first edge is greater than
the second, unless rounding makes them equal. [GLSL ES 3.00](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf#page=97)
declares `smoothstep` results undefined in both cases. The
[WGSL definition](https://www.w3.org/TR/WGSL/#smoothstep-builtin)
specifies the Hermite formula for unequal edges, including descending ones.
Thus mirroring the expression does not establish a portable GLSL reference.

For an isolated diagnostic, the corresponding ascending GLSL expression is
`1.0 - smoothstep(0.5 - smoothing, 0.5, abs(pos.y))`. The arrow-body expression
has an analogous conversion. These are equivalent to the intended descending
formula in real arithmetic when the two edges remain distinct; finite-precision
rounding and the original undefined expression can still change pixels. Try
both expressions on both APIs, with the original production draws retained as
controls, before proposing a production change. **This defect is established by
the specification; it has not been shown to cause the observed M3 failures.**
It cannot explain a carrier fragment that is absent before fragment shading.

### 2. Hard coverage magnifies tiny differences

The recorded width-3 witness at `(100,96)` has transverse coordinates `-0.375`
and `-0.3750000298` in the two APIs. Their measured coverages are `0.5` and
`0.4999998212`. The hard branch turns that small difference into an opaque
pixel versus no pixel. In the earlier diagnostic, explicit linear interpolation
did not change the M3 result; the pixel-distance method removed the WebGPU
CPU-mask errors in three isolated cases but changed original WebGPU color and
did not repair every WebGL-versus-CPU mismatch.

The clipped oblique witness `(435,19)` is more informative than a tie alone. At
zoom 2 its ideal screen-space endpoints are `(392,-30)` and `(664,244)`, its
core half-width is 4 device pixels, and the sample center is `(435.5,19.5)`.
The ideal perpendicular distance is approximately `4.0017313` pixels, giving
CPU coverage `0.4974030`. The recorded float probes report about `0.500201`
and `0.500200`, and both ordinary color draws paint an opaque pixel. Those
coverage values correspond to an effective distance about `0.0019` pixel
closer to the center than the ideal distance, if interpreted through the same
Hermite ramp. The source is near a viewport clip boundary, so clip-generated
vertices and interpolation setup are plausible contributors; vertex rounding,
rasterizer precision and other arithmetic remain alternatives. **The capture
does not isolate which contributor caused this displacement.**

At that pixel both candidate IDs are background while both colors are opaque.
The candidate's analytic half-width test agrees with the CPU, but the original
hard color uses interpolated coverage. Therefore zero *invisible* picks does not
prove that every painted hard-edge pixel is pickable. For blended links, the
candidate deliberately excludes some visible antialiasing fringe below half
coverage, so a reverse-direction check must state the intended picking policy.

### 3. Caps and the reference have a separate boundary problem

In the recorded vertical-cap replay, both APIs receive identical captured
float32 clip vertices, yet disagree on carrier fragments, and each neutral
carrier replay matches its own native probe. That localizes the disagreement
to the raster path, including viewport conversion and edge ownership, rather
than establishing a particular driver rounding algorithm. WebGPU specifies
pixel-center sampling without defining inclusion exactly on a polygon edge; the
[polygon rasterization rules](https://www.w3.org/TR/webgpu/#polygon-rasterization)
also flag precision as relevant. The scalar reference's double-precision quad
and top-left rule are an independent comparison policy, not a portable promise
about either API's exact edge pixels.

Rounding is a plausible explanation for why a `1/1024` device-pixel shift does
not always change a cap while a `1/8` shift does. Other raster pipelines can
snap post-clipping positions before rasterization, as described in the
[Direct3D 11.3 specification](https://microsoft.github.io/DirectX-Specs/d3d/archive/D3D11_3_FunctionalSpec.htm);
that is an example of a permitted design, **not evidence of the M3 grid size or
the mechanism in this capture**. Do not infer a universal correction offset.

### 4. A positive-width short link can miss every sample

Under the stated single-sample model, take a horizontal link from
`(100.1,100.25)` to `(100.2,100.25)` in device pixels, with core width 1 and
nonzero opacity. Its butt-capped carrier spans only `100.1..100.2` in x; no
pixel center has an x coordinate in that interval. No color or ID fragment can
be generated, even though the width is floored to one pixel. This applies to
the blended carrier as well as hard mode. It is a theoretical case, not evidence
that a practical graph has exhibited a vanished link. Short segments, moving
layouts and fractional zoom need explicit checks before the pilot's no-vanishing
rule can be assessed. Coincident endpoints are a separate degeneracy: the
production vertex shader normalizes a zero vector, while the lab's WGSL port
explicitly culls a zero-distance link. A zero-length test does not establish the
behavior of a short, positive-length link.

### Recommended next experiments

1. **Reproduce the baseline and vary only coverage arithmetic.** Run the
   existing 40-row sweep and the hard/cap replays on the current pinned luma and
   native device. Add diagnostic ascending-edge coverage on WebGL and WebGPU;
   compare float probes, ordinary color bytes, candidate IDs and the unchanged
   scalar reference. Include the arrow-body expression in a separate scoped
   check. If M3 values do not improve, the undefined GLSL call remains a
   portability issue rather than the explanation of these failures.
2. **Separate clipping from interpolation.** Replay the clipped oblique source
   and an otherwise equivalent, fully visible placement, preserving device-pixel
   phase and comparing corresponding samples. Capture each backend's float32
   vertices and varyings, then compare observed interpolation with a barycentric
   calculation on those captured vertices. Control viewport-transform and
   translation rounding: moving a source alone changes more than clipping. A
   persistent difference points beyond clipping; a change only when clipped is
   evidence for the clipping/interpolator path, not proof of a specific driver
   implementation.
3. **Prototype a common geometric decision, without replacing controls.** Test
   a conservatively enlarged carrier with explicit longitudinal butt-cap and
   transverse distance tests in both color and ID passes. State the tie rule,
   guard degenerate endpoints, and verify the carrier is conservative for the
   tested coordinate range. Measure original-color changes, overlaps, edge
   pixels, source visibility and fill cost. This can change both color and
   picking. A corrected pair cannot become identical while retaining every
   original color byte where the original backends already disagree.
4. **Exercise visible behavior, not only still-image mismatch counts.** Sweep
   subpixel translations and zoom continuously across short and long links,
   widths around one device pixel, several angles, DPR 1/2 and viewport edges.
   Record per-source painted and pickable pixels, gaps, flicker, ordering and
   geometry-relative boundary displacement. Keep strict failures separate from
   the existing one-device-pixel pilot allowance; that allowance does not excuse
   vanished thin links, wrong interior colors/IDs or invisible foreground picks.

The `30/40` strict result, original-color controls and practical pilot verdict
are unchanged. In particular, the pilot remains **not assessed**. The next
experiment should measure before promoting any alternative or changing a gate.

## Pattern boundary audit · 17 November 2026

**The first straight dash rejection is an interpolated side/coverage tie, not
a phase mismatch.** An isolated replay of the existing ribbons fixture at
pixel `(40,96)` reports phase `0.5` in both APIs, with the same phase derivative
within float32 rounding. The independent CPU also gives phase `0.5`.

| Observation | WebGL | WebGPU | CPU |
|---|---|---|---|
| Ribbon side | −0.375 | −0.3750000298 | −0.375 |
| Combined coverage in float probe | 0.5 | 0.4999998212 | 0.5 |
| Ordinary candidate ID | Source 0 | Background | Source 0 |
| Ordinary blended RGBA | `[76,54,31,89]` | `[76,54,31,89]` | — |

The source is relabeled to 0 only by this isolated fixture. Its half-coverage
edge retains the exact cutoff: no epsilon, changed ID or color rounding rule
is introduced. Matching blended bytes do not imply identical picking at that
cutoff. The full pattern acceptance result remains **14/24**; this diagnostic
does not rerun or replace that matrix.

The native float probes run after ordinary images through public luma APIs.
Checks compare ordinary color and ID buffers before, during and after probes.
They capture phase/derivatives/coverage, dot radius/derivatives/diameter, and
ribbon coordinates/smoothing/width. WebGPU also captures explicit fine and
coarse derivative variants. These are diagnostic programs, not acceptance
renderers or a source of CPU masks. See the [curve investigation](#/curved-links?section=doc-method-pattern-boundary-audit-17-november-2026)
for why a changed diagnostic program must not be treated as the original draw.

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/curved-links/pattern-diagnostics.test.ts
```

Open the printed session in the local native browser. The ignored local
`link-pattern-boundaries.json` capture records device, browser, isolated
inputs and witnesses. Production shaders and acceptance gates remain unchanged.

## Dash and dot patterns · 17 November 2026

**The patterned candidate passes 14/24 full-frame cases on Apple M3.**
Every case preserves each backend's original production color bytes exactly.
Production gap-picking remains a separate unchanged control; the candidate
requires half coverage of the patterned paint and the existing source-alpha
eligibility rule. The exact-ID, CPU-mask, 2/255 color and zero-invisible-pick
gates are unchanged.

| Stroke | Candidate passed / checked |
|---|---|
| Dashed | 6 / 12 |
| Dotted | 8 / 12 |

The latest two full straight-pattern replays have **zero invisible frame or
isolated-source picks** in both backends. Full-frame acceptance remains 14/24:
the remaining mask/color discrepancies are still rejected. Passing the focused
preservation and visibility tests does not accept those rows.

Two earlier runs reported 12 invisible WebGL candidate picks in the zoom-2,
constant-screen-pattern overlap case. That observation has not reproduced in
the latest full replays or the targeted repeatability check below. Its cause
is unresolved; this is not evidence of a proven fix. Patterned candidate IDs
use the original color vertex shader and color-mode vertex uniforms. The
separate solid/gradient controls retain their original shaders.

Recorded **17 November 2026**, ANGLE Metal / Apple WebGPU, inline Chromium 157,
luma **10.0.0-alpha.15**. The 24 cases are two existing scenes × dashed/dotted ×
six profiles: blended, hard, DPR 2, zoom-2 constant-screen patterns with dash
length 7.5/gap 3.25, reversed endpoint gradients at opacity 0.35, and opacity
zero. Other profiles use dash length/gap 5. This is a bounded local study;
short-link extremes, arbitrary pattern parameters, animated updates and cost
are not covered by it.

### Production pattern rules

Production uses the ribbon parameter times the endpoint **chord length**,
including on curves. This is not distance integrated along the curved path.
When widths scale with zoom, pattern units are world units; otherwise the
chord and carrier width are multiplied by zoom to keep pattern units in CSS
screen pixels. DPR enters the antialiasing ramp, not a second pattern zoom.

Dashes repeat every `dashLength + dashGap`. Dots repeat every visible stroke
diameter plus the gap; hard dots have production's minimum diameter of
approximately √2 device pixels. Both multiply the existing ribbon coverage.
Production deliberately omits the pattern mask in its ID pass, keeping gaps
pickable. The visible-pixel candidate applies it to IDs too; it does not change
production interaction policy or any rendered color.

The port uses `dpdx`/`dpdy`/`fwidth` before any style branch or discard, as
required for [WGSL derivative uniformity](https://www.w3.org/TR/WGSL/#derivative-builtin-functions).
The CPU independently extrapolates each primitive's parameter and side values
at four pixel centers and uses fine local differences. Native default
derivatives may be fine or coarse. This CPU model is explicit, not a promise
to predict every driver's derivative choice; its discrepancies stay failures.
No GPU mask/readback supplies CPU expectations.

### Dash-wrap repeatability

The targeted replay checks the previously implicated dashed overlap on fresh
devices and after switching through all six profiles. Each is repeated at the
original coordinates and at horizontal shifts of −1/1024 and +1/1024 device
pixel. All **12 backend/history/shift checks** preserve original colors exactly
and report zero invisible picks on M3. The test still requires zero; it records
pixel coordinates, IDs, stored RGBA and independently calculated phase when a
witness exists.

The production dash formula is discontinuous at a period wrap: its smooth
start contributes half coverage at remainder zero, while the preceding gap
approaches zero. Interpolation rounding is therefore a plausible boundary
mechanism, but these passing replays do not establish why the earlier runs
differed. Keep that uncertainty alongside the rejected full-frame rows.

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links/patterns.test.ts src/experiments/straight-links/pattern-boundary.test.ts
```

### Reproduce the pattern comparison

Choose **Stroke → dashed/dotted**, then set **Dash length** and **Pattern gap**.
Dash length controls dashes; dot diameter comes from stroke width. Both color
source modes remain available. The full scene sweep uses the selected color
and pattern settings; fixed boundary-replay tools retain their recorded solid
controls. For the bounded 24-case pattern study:

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links/patterns.test.ts
```

Open the printed session URL in the local native browser. Local JSON captures
retain every comparison, preservation result and isolated-source visibility
count, including rejected rows. They are not committed. Solid and endpoint-
gradient matrices remain separate regression controls.

## Endpoint gradients · 17 November 2026

**The visible-footprint candidate passes 30/40 full-frame cases with endpoint
RGB enabled.** All 40 cases preserve each backend's production gradient
color bytes exactly and have zero invisible frame/source picks. The remaining
10 cases stay rejected under the original exact-ID, independent CPU-mask
and **2/255** color gates. A completed test run is not full rendering acceptance.

Recorded on **Apple M3**, ANGLE Metal / Apple WebGPU, inline Chromium 157,
luma **10.0.0-alpha.15**. This is a bounded local comparison, not a portability
or performance claim. The existing solid-color matrix is replayed separately
on the same setup; every row retains the same pass/fail verdict and mask/ID
error counts with gradients enabled.

| Scene | Gradient candidate passed / checked |
|---|---|
| Ordinary ribbons | 8 / 10 |
| Overlap | 8 / 10 |
| Width/default/absence limits | 8 / 10 |
| Fractional boundaries | 6 / 10 |

### What production interpolates

With `linkColorInterpolateFromEndpoints` enabled, Cosmos reads the source and
target **point colors** and mixes their RGB using the ribbon's interpolated
parameter `t`, clamped to 0–1:

```text
RGB = sourceRGB × (1 − t) + targetRGB × t
alpha = linkAlpha × globalOpacity × thinWidthFactor × coverage
```

Endpoint alpha does not fade the link. NaN endpoint channels use
`pointDefaultColor`; absent endpoints still suppress their links. Hard-edge
mode keeps the original opaque-output rule. No color-space conversion,
source-alpha quantization or new picking threshold is introduced.

The CPU computes the longitudinal projection onto the straight segment.

The WebGL adapter supplies point colors and enables the existing production
uniforms; the imported GLSL remains unchanged. WebGPU uses a separate gradient
color pipeline through public luma APIs. Solid-color and ID shader sources
remain unchanged. The CPU reference independently evaluates the gradient and
retains its original coverage and byte-composition rules.

Focused checks cover endpoint alpha 0/0.35/1, ignored per-link RGB in gradient
mode, per-channel and wholly missing point colors, a non-white default with
alpha zero, global opacity zero in both blend modes, exact gradient/solid ID
identity and restoring the solid control. Default-channel and endpoint-alpha
cases also compare CPU and GPU color at the existing budget. The matrix adds
overlap, reversed order, zoom, DPR 2, fractional widths and hard/blended modes.

### Try and reproduce gradients

Choose **Color source → Endpoint RGB**, **Endpoint alpha ignored** or
**Default endpoint channels** in Configuration. The live report and full sweep
use that selection. **Link color · control** restores the original solid
study. Boundary-replay diagnostics keep their original solid controls.
Cancellation preserves the selected mode and displayed scene. Export JSON
retains the live inputs, sweep color preset and reproduction fixtures locally.

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links/gradients.test.ts
```

Open the printed session URL in the existing native browser. Local captures
contain both `solidRows` and gradient `rows`, including rejected results;
measurements are not committed. The pattern comparison above retains
these boundary and original padded-picking controls.

## Faint-alpha picking replay · 17 November 2026

**The visible-footprint candidate makes zero invisible frame or foreground
picks in all 72 cases and preserves original color bytes exactly. Full-frame
acceptance is 64/72; eight edge cases remain rejected.**

Recorded **17 November 2026**, Apple M3 / ANGLE Metal and Apple WebGPU,
inline Chromium 157, luma **10.0.0-alpha.15**. This is a focused local replay,
not a repeat of the older feature matrix or a portability claim. Production
shaders, candidate shaders, CPU references, colors and acceptance gates are
unchanged; the replay only supplies new inputs and reads existing outputs.

The population has **72 cases** per link type:

- 48 native-ratio cases: eight alpha inputs × opacity 0/0.35/1 × isolated/overlap.
- 12 ratio-2 cases around the first byte threshold at opacity 0.35 and 1.
- Six reversed-order overlap cases around that threshold.
- Six hard-edge controls using alpha `1/65536`, all three opacities and both scenes.

The alpha inputs include zero, `1/65536`, the float32 value nearest
`0.5 / 255 / float32(opacity)` and its immediate neighbors, a one-byte interior
alpha, 0.35 and 1. Compensating the threshold input for opacity keeps the
positive-opacity replays near the same attachment boundary. The zero-opacity
control uses the opacity-one sample inputs. These are full-frame comparisons,
not checks restricted to a favorable interior pixel.

Source ID **1** is the faint link; ID **0** is a wider blue underlying link.
Isolation sets only the underlying width to zero, preserving IDs. Every
candidate ID selecting source 1 is checked against that link's own isolated
stored alpha. At global opacity 1 the underlying link is opaque; at 0.35 both
links receive the original global-opacity rule. Thus composed background alpha
cannot conceal an invisible foreground pick. The independent CPU reference
still supplies masks and colors; isolated readback supplies the separate
actual-source-visibility check.

At the opacity-one interior probe, both APIs behave identically:

| Input alpha | Predicted byte | Isolated stored RGBA | Candidate overlap ID |
| --- | --- | --- | --- |
| 0.0019607841968536377 | 0 | `[0, 0, 0, 0]` | 0: underlying link |
| 0.0019607844296842813 | 1 | `[0, 0, 0, 1]` | 1: faint link |
| 0.001960784662514925 | 1 | `[0, 0, 0, 1]` | 1: faint link |

The middle input is the nearest float32 to the mathematical half-byte
threshold, not an exactly representable half-byte tie. The production padded
ID control selects source 1 for all three samples. Its broader interaction
policy remains recorded separately, not relabeled as candidate behavior.

The straight scene runs from `(80, 160.5)` to `(432, 160.5)`, with a six-pixel
foreground and fourteen-pixel underlying link. The interior probe above is
`(150, 160)` at ratio 1. The production padded control passes 20/72 full-frame
comparisons under the existing visible-image criteria; 44 cases select some
foreground pixels with zero isolated alpha. This control's failures do not
change the candidate's criteria.

| Retained failure group | Cases | Observed disagreement |
| --- | --- | --- |
| Blended, one-byte interior alpha | 4 | 704 WebGL/WebGPU ID differences per case; 352 CPU mask failures per backend. Colors stay within 1/255. |
| Hard-edge, tiny positive alpha | 4 | 704 ID differences in isolation or 1408 in overlap; CPU/color differences remain, up to 255/255. |

For example, at opacity 1 and input alpha `1/255`, the isolated pixel `(80,157)`
is selected as ID 1 by WebGL and CPU; WebGPU leaves it empty. Over the blue link,
WebGPU falls through to ID 0. Neither backend selects a source whose own stored
alpha is zero. The same edge splits occur at opacity 0.35 after compensating
input alpha. They concern coverage and mask agreement; this replay does not
establish their exact arithmetic cause or waive the failures. Hard mode retains
production's opaque output for positive opacity, so its errors are not small
faint-color differences.

This closes the narrow invisible-source question on this device. Keep the eight
new input rejections alongside earlier raster/coverage blockers and proceed to
endpoint gradients; do not infer whole-feature acceptance from visibility alone.

### Repeat locally

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links/faint-alpha.test.ts
```

Open the printed session URL in the local browser. The test asserts unchanged
color bytes and zero invisible picks; it records, rather than overrides, each
full-frame acceptance verdict. Its ignored `captures/local/straight-link-faint-alpha.json`
contains inputs, settings, devices, both policy comparisons, CPU results, source
counts and first failing pixels. No raw capture is committed.

## Question

Can luma WebGPU preserve production Cosmos straight-ribbon rendering and select the visible link at a pixel?

The WebGL control imports the unmodified production `draw-curve-line.vert` and `.frag`, conic module and picking-color module. With one segment, zero control-point offset, weight one, solid style and no arrows, the production geometry is `[0,+0.5], [0,-0.5], [1,+0.5], [1,-0.5]`, rendered as an instanced triangle strip. This is the production draw/host-pick shader hosted through luma v10; it is not the complete Graph runtime.

WebGL uses public luma `Model`, `UniformStore`, buffers, textures and render passes. WebGPU uses `RenderKernel`, storage-buffer endpoint/link reads, a vertex array and uniform buffers. Both render RGBA8 color and unblended 24-bit ID targets, then read them through public luma copies/readback. WebGL rows are flipped; WebGPU copy rows are 256-byte aligned. No raw graphics handles or native commands are used. The color pass remains the same when switching picking policies.

```flow
Frozen point positions and link channels · original indices, widths, colors and absence
Production ribbon geometry · width/zoom cap, one-pixel ramp and subpixel attenuation
Color pass · source-over blending or opaque hard edges
Host ID pass · original padded control or separate visible-footprint candidate
Readback · exact GPU/CPU masks, 2/255 colors, source visibility and color preservation
```

## Width, color and picking contracts

- Per-link width is resolved against the default, multiplied by width scale, adjusted by the production zoom rule and capped by maximum point size. Zero width is culled before the minimum-width floor. Blended strokes use a minimum one-device-pixel core and attenuate alpha by true width/core width. A one-device-pixel ramp extends the carrier by another pixel.
- Unblended links use hard half-coverage edges, overwrite with opaque color, and remain at least a device pixel wide. Positive opacity magnitude is ignored after the visibility test; opacity zero remains hidden. This is production behavior.
- Width/color NaN defaults, endpoint absence, overlap, reverse order, zoom and DPR are frozen inputs. Color is per-link RGBA. This first study disables distance fading, arrows, patterns, endpoint gradients, hover/focus and transitions. Straight links have butt caps and no longitudinal antialiasing extension.
- The production host-ID shader adds **five CSS pixels of total ribbon width**, then uses its own half-coverage contour. It can therefore select outside the visible ribbon. This is a retained interaction-policy control, not a WebGPU implementation defect.
- The separate **visible-footprint candidate** removes the ID-width addition. It reconstructs the half-width contour from pixel coordinates and flat endpoint/normal values, avoiding the varying's interpolation at this decision. Blended picking also requires a nonzero quantized source-alpha byte, using the original source opacity and coverage. Hard picking additionally requires the original fragment shader's `coverage >= 0.5`, so an analytic tie cannot select a fragment discarded by the unchanged hard color pass. Positive alpha suffices in hard mode because a surviving fragment writes alpha one. This intentionally changes picking policy; matching the candidate does not approve legacy compatibility.

The scalar reference independently constructs the mathematical ribbon and its two triangles, applies a top-left pixel-center raster rule, evaluates transverse smooth coverage and source alpha, and resolves the last eligible original link ID. Color is independently composed into RGBA8. It never reads a GPU mask to select expected IDs. Fractional raster/cap ties remain failures if GPU and scalar classification differ. Boundary counterexamples from the first aligned diagonal ribbons are retained in the dedicated boundary fixture.

**Acceptance is unchanged:** exact IDs and scalar masks at every pixel, at most **2/255** per color channel, and no picked zero-alpha pixels. Additional checks require unchanged color bytes when switching ID policy. Very faint link sources are also drawn in isolation, so an opaque background cannot conceal an invisible selected foreground. Matching two GPUs alone does not pass the experiment. No mask epsilon or excluded boundary pixels are used.

The WGSL port mirrors production's descending Hermite interpolation. The [WGSL smoothstep definition](https://www.w3.org/TR/WGSL/#smoothstep-builtin) specifies its formula for both edge orders. Rasterization tests pixel centers at `(0.5,0.5)` for single-sample targets; see [WebGPU rasterization](https://www.w3.org/TR/webgpu/#rasterization). Native edge-rounding and arbitrary geometry still need measurements; the reference is a declared independent comparison, not a claim of universally bit-exact hardware rasterization.

## Repeatable population

Four fixtures cover ordinary horizontal/vertical/oblique ribbons, overlap including a faint foreground, zero/subpixel/default/capped widths and absent/coincident endpoints, and fractional/aligned boundaries. Five profiles are native, ratio two, zoom 0.5 with opacity 0.35 and reverse order, constant-width zoom two, and opacity zero. Both blended and hard opaque modes give **40 cases**. Each retains production, candidate and compatibility verdicts plus unchanged-color and faint-source checks.

## Recorded result — Apple M3, 15 November 2026

**The visible-footprint candidate passes 30/40 cases. Straight-link rendering is partially validated; it is not ready for production acceptance.** This was a complete sweep in Codex's inline Chromium 157, using Apple M3 / ANGLE Metal for WebGL and the Apple WebGPU adapter, with luma `10.0.0-alpha.4`. These are same-machine correctness measurements, not performance or portability results.

| Scene | Candidate accepted / checked | Production control accepted / checked |
| --- | --- | --- |
| Ordinary ribbons | 8 / 10 | 2 / 10 |
| Overlap and faint foreground | 8 / 10 | 2 / 10 |
| Width limits, defaults and absent endpoints | 8 / 10 | 2 / 10 |
| Fractional and aligned boundaries | 6 / 10 | 2 / 10 |
| Total | **30 / 40** | **8 / 40** |

Eight accepted candidate rows have opacity zero; **22/32 nonzero-opacity cases** pass. The production control and production-WebGL/candidate-WebGPU compatibility comparison each pass only the eight opacity-zero rows. A visible-footprint policy therefore is not legacy picking parity.

- Every candidate row has **zero picked pixels with zero composed alpha and zero invisible faint-source selections**, including the faint foreground over an opaque background. Original color bytes are preserved exactly in **40/40** cases on both APIs.
- Candidate GPU IDs agree in **34/40** rows. GPU colors stay within the existing budget in **34/40**, with exact color bytes in 32. Accepted rows have at most one channel level of cross-GPU color difference. GPU agreement does not override the scalar reference.
- The default blended ordinary scene passes exact IDs, independent masks and color checks. Per-link RGBA/default channels, tiny and capped widths, both zoom rules, DPR, order, absence and mode switching have bounded coverage. The fixture's coincident-endpoint observation is not a portable production guarantee: the original shader normalizes a zero vector.
- The first sweep's analytic-only hard pick selected discarded color fragments. Adding the original hard-color coverage test removes all of those invisible picks while leaving every color byte unchanged. It does **not** resolve the color/CPU boundary failures below, so the overall count remains 30/40.

All ten rejected cases remain in the repeatable population. Counts below are pixels, not a relaxed allowance. “CPU mask” compares IDs with independent mathematical triangles and the declared top-left rule; “CPU color” compares with independent RGBA8 composition.

| Rejected scene / profile / mode | GPU ID differences | CPU mask failures · GL / GPU | GPU color failures > 2/255 | CPU color failures · GL / GPU |
| --- | ---: | ---: | ---: | ---: |
| Ribbons / native / hard | 180 | 0 / 180 | 180 | 2 / 182 |
| Ribbons / constant width, zoom 2 / hard | 0 | 0 / 0 | 0 | 1 / 1 |
| Overlap / zoom 0.5, opacity 0.35, reversed / blended | 12 | 12 / 0 | 12 | 12 / 0 |
| Overlap / zoom 0.5, opacity 0.35, reversed / hard | 12 | 12 / 0 | 12 | 12 / 0 |
| Limits / zoom 0.5, opacity 0.35, reversed / hard | 170 | 85 / 85 | 170 | 85 / 85 |
| Limits / constant width, zoom 2 / hard | 0 | 396 / 396 | 0 | 396 / 396 |
| Boundaries / native / blended | 2 | 8 / 6 | 2 | 10 / 8 |
| Boundaries / native / hard | 183 | 188 / 367 | 183 | 188 / 367 |
| Boundaries / ratio 2 / blended | 0 | 2 / 2 | 0 | 2 / 2 |
| Boundaries / ratio 2 / hard | 0 | 2 / 2 | 0 | 2 / 2 |

For the native hard ribbon, `(40,96)` is a first mismatch: WebGL and the scalar reference select link 1, but WebGPU's unchanged color coverage discards it, and the candidate correctly leaves its ID empty. The zoomed overlap first differs at `(253,102)`, at an aligned vertical ribbon cap. In the ratio-two boundary cases, both GPUs select link 7 at `(927,382)`, while the unchanged scalar reference rejects that butt-cap tie. These are reproducible localization clues; they do not yet prove one common arithmetic cause.

The follow-up below isolates the hard-edge mechanism. The cap/top-left and fractional raster differences remain separate gates. Keep the original production shaders, scalar reference and acceptance unchanged. Broader styles can follow once these counterexamples are understood or explicitly retained as blockers. No boundary pixels are omitted and no epsilon is added.

## Hard-edge coverage investigation

**Interpolation can put an edge pixel on the opposite side of the hard discard.** Three isolated sources reproduce this in Codex's inline Chromium 157 on Apple M3. The original strip geometry and ordinary production draws stay intact. Separate unblended RGBA32F programs expose the interpolated transverse coordinate, smoothing and coverage, then projected pixel distance, half-width and pixel-space coverage. All copies/readback use public luma APIs. Probes never supply expected IDs to the scalar reference.

| Isolated source / observed pixel | Coordinate y · WebGL / WebGPU | Coverage · WebGL / WebGPU | Pixel distance / half-width, both APIs |
| --- | --- | --- | --- |
| Width 3, native · `(100,96)` | `−0.375` / `−0.3750000298023224` | `0.5` / `0.4999998211860657` | `1.5 / 1.5` |
| Default color, zoom 0.5 · `(280,135)` | `0.40000006556510925` / `0.3999999463558197` | `0.4999995231628418` / `0.5000003576278687` | `2 / 2` |
| Minimum width, zoom 2, clipped · `(100,11)` | `0.2500693202018738` on both | `0.49979203939437866` on both | `0.5 / 0.5` |

The first coordinate difference is one ULP at that magnitude. The clipped minimum-width case is much larger: it should not be described as universally a one-ULP problem. A tiny change around the `0.5` hard cutoff can still produce a full `255/255` color difference because a surviving hard fragment writes opaque color and a discarded fragment writes nothing. This is not a source-alpha quantization failure.

In these isolated captures, the probe predicate predicts each ordinary color's presence. Ordinary color/ID readbacks are unchanged with probing enabled, and restored draws are checked after changing methods. The probes are separate compiled programs, so the UI explicitly flags any future capture that fails that consistency check.

### Three WebGPU methods, same reference

- **Native:** the retained perspective-interpolated coordinate and original `smoothstep` expression.
- **Linear:** explicit `@interpolate(linear, center)` on the transverse coordinate, with the same coverage expression. This gives the same masks, colors and probe values as native on this M3 replay. All clip positions have `w = 1`, but mathematical equivalence does not promise identical hardware rounding.
- **Pixel:** an opt-in hard-only diagnostic reconstructs transverse distance from the fragment's pixel center and flat ribbon origin/normal. Its one-device-pixel ramp is `smoothstep(halfWidth + 0.5, halfWidth - 0.5, distancePx)`. Both the color and visible-ID pass use this coverage, without an epsilon. It runs only in this replay; production picking and the normal 40-case sweep keep their original arithmetic. Blended rendering is unchanged.

WGSL defaults floating IO to perspective interpolation at the pixel center; it also supports linear interpolation. See [WGSL interpolation](https://www.w3.org/TR/WGSL/#interpolation). Its [floating-point accuracy rules](https://www.w3.org/TR/WGSL/#floating-point-accuracy) permit variation in compound expressions, including inherited `smoothstep` accuracy. These rules explain why identical real-number formulas are insufficient to promise bitwise parity; the measured interpolation values above localize this replay's failure.

| Isolated source | Native / linear CPU mask failures · GL / GPU | Pixel CPU mask failures · GL / GPU | Pixel GPU pair color failures > 2/255 | WebGPU original color pixels changed by pixel method |
| --- | ---: | ---: | ---: | ---: |
| Native width 3 | `0 / 180` | `0 / 0` | `0` | `180` |
| Zoom 0.5, default color | `85 / 85` | `85 / 0` | `85` | `85` |
| Clipped minimum width, zoom 2 | `106 / 106` | `106 / 0` | `106` | `106` |

All three pixel-space WebGPU images have zero CPU-mask failures, zero CPU-color failures and zero invisible picks. All nine method comparisons preserve WebGL color bytes. **None passes all retained gates:** the pixel method changes original WebGPU color pixels; two cases also retain production WebGL-versus-CPU errors. This is a promising coverage correction, not an accepted pick-only replacement or a change to the production control.

The minimum-width isolation reports 106 errors, rather than the full scene's 396, because only original link 1 is drawn. Other links keep their indices but receive width zero. The complete scene and every historical rejection remain in the regular sweep.

The nearby-edge regression shifts the width-3 center by `±1/1024` CSS pixel. Pixel-distance WebGPU remains exact against the full CPU mask and color image and selects the expected side. The unchanged WebGL color can still disagree; the pair is not approved merely because the candidate is more accurate. No pixel exclusion or acceptance tolerance changes are involved.

**Consequence:** an ID-only patch cannot recover a visible pixel discarded by the color shader while also forbidding invisible picks. Removing this mechanism requires a color-coverage correction. The diagnostic quantifies that correction and its original-color differences; it is not promoted under the unchanged preservation gate. The default candidate remains **30/40**, with cap/fractional raster differences still to investigate.

## Cap and fractional raster investigation

**Cap failures can happen before the fragment shader runs.** The follow-up uses Codex's inline Chromium 157 on Apple M3 with the same production GLSL, WebGPU port, scalar masks, color budget and original-color gate. It adds no renderer correction.

A **48-row sensitivity replay** isolates eight original sources. Each tests the original input, endpoint reversal, and translations of `±1/1024` and `±1/8` **device pixel** along its declared axis. Translation is converted back to input coordinates using zoom and DPR. Moving an input is an investigation of its boundary, not a repair of its original result. Original link IDs remain stable; other widths are zeroed to prevent overdraw from hiding a failure.

### Check the carrier before checking coverage

Separate float programs capture all four pre-clipping vertex positions as one-pixel points in a tiny RGBA32F target. A second pair of trivial shaders then draws **the same four captured float32 clip positions** on both APIs, without endpoint, normal, projection or coverage calculations. All buffers, pipelines, render passes and readback use public luma APIs. Ordinary production color/ID arrays are checked before and after diagnostics and after restoring the control.

```flow
Input endpoints · original coordinates, widths and link IDs
Vertex shader · capture the four clip positions separately
Viewport and polygon rasterizer · determine whether a fragment exists
Coverage and color · a missing invocation cannot be recovered here
ID and CPU comparison · unchanged masks, color and visibility gates
```

| Original source | CPU mask failures · GL / GPU | Same-vertex carrier differences · GL vs GPU | Carrier replay versus native · GL / GPU |
| --- | ---: | ---: | ---: |
| Vertical half-pixel caps | `2 / 0` | `4` | `0 / 0` |
| Vertical caps, zoom 0.5 | `12 / 0` | `14` | `0 / 0` |
| 3:1 end cap, ratio 2 | `2 / 2` | `0` | `0 / 0` |
| 45° start cap | `6 / 6` | `0` | `0 / 0` |
| Horizontal cap control | `0 / 0` | `360` | `0 / 0` |
| Width 2.5 control | `0 / 0` | `181` | `0 / 0` |
| Fractional oblique control | `0 / 0` | `0` | `0 / 0` |
| Clipped hard oblique | `0 / 0` | `0` | `0 / 0` |

The two vertical cases remain different with identical supplied vertices, and the carrier replay reproduces each API's native float-probe footprint. This isolates the difference to the raster path, including viewport precision and edge ownership, rather than different endpoint/extrusion shader calculations. It does not identify a driver's internal rounding algorithm.

At the nominal cap pixel `(280,40)`, WebGL generates no carrier fragment; WebGPU generates one with coverage one. At `(280,260)`, the roles reverse. Color and picking follow that difference:

```text
nominal y =  40.5   first cap   WebGL background   WebGPU link 2
                    │
                    │ ribbon
                    │
nominal y = 260.5   last cap    WebGL link 2       WebGPU background
```

Carrier differences are not automatically visible failures. The horizontal and width-2.5 controls pass their original ID/color gates despite differences at carrier fringes. The carrier includes the antialiasing ramp, including fragments that paint no color. It is an explanatory capture, not a new acceptance mask.

[WebGPU polygon rasterization](https://www.w3.org/TR/webgpu/#polygon-rasterization) defines single-sample pixel-center sampling but leaves inclusion on a polygon edge unspecified, with precision involved. [OpenGL ES 3.0, §3.6.1](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf#page=117) requires unique ownership on a shared polygon edge, without promising the same convention across APIs. The existing scalar top-left rule therefore remains a declared comparison policy; it is not a universal hardware guarantee. These specification limits explain portability concerns and **do not waive any rejected pixel**.

### Exact cap signs versus rounded quads

A separate dyadic-integer diagnostic evaluates the longitudinal cap planes and triangle edge signs over their stored binary coordinates. It adds no epsilon and never supplies expected IDs to acceptance.

- At `(927,382)`, the ratio-two 3:1 ribbon's input geometry puts the pixel exactly on its end cap. Both GPUs select link 7; the unchanged scalar mask and its exact stored-quad sign reject it. Its corresponding start-cap tie is rejected by both GPUs and accepted by the scalar reference. The GPU pair agrees while the two CPU failures remain.
- At `(326,62)`, the 45° source is exactly on its input start-cap plane. Both GPUs select link 6. The current scalar mask **and the exact sign of its rounded double-precision quad** reject it. This distinguishes the mathematical source plane from the quad produced by normal calculation and extrusion; this sample does not demonstrate a wrong scalar cross-product sign. The six source rejections remain in place.
- Captured vertices are float32 values before fixed-function clipping/viewport conversion. Their exact top-left signs describe those stored numbers, not a replacement model of the hardware rasterizer. The neutral carrier replay checks their relationship to the measured native footprint.

### Sensitivity results and the remaining body-edge case

**29/48** rows pass all retained gates. Every row preserves original color bytes on both APIs and has zero invisible picks. Every carrier replay matches its corresponding native float footprint. Endpoint reversal changes **zero CPU IDs, GPU IDs and color pixels** in all eight sources.

| Source | Accepted / checked | Main rejected population |
| --- | ---: | --- |
| Vertical half-pixel caps | `2 / 6` | Original, reversal and both 1/1024-pixel shifts |
| Vertical caps, zoom 0.5 | `2 / 6` | Original, reversal and both 1/1024-pixel shifts |
| 3:1 end cap, ratio 2 | `4 / 6` | Original and reversal |
| 45° start cap | `4 / 6` | Original and reversal |
| Horizontal cap control | `5 / 6` | Positive 1/1024-pixel shift |
| Width 2.5 control | `6 / 6` | None in this population |
| Fractional oblique control | `6 / 6` | None in this population |
| Clipped hard oblique | `0 / 6` | One CPU-color failure per input variant |

All tested cap sources pass after a 1/8-device-pixel translation. The smaller 1/1024 shift is insufficient for the vertical cases; reversing its sign switches which API matches the CPU. The horizontal control also acquires a rejection under the positive tiny shift. The record supports subpixel raster sensitivity, not a portable raster grid size or a coordinate-offset workaround. Fractional width and oblique coordinates alone are not generally broken: those two controls pass all twelve comparisons.

The original clipped hard oblique isolates link 5 at zoom two with constant screen width. Its remaining mismatch is `(435,19)`: both GPUs paint an opaque pixel and both candidate IDs match the CPU background. CPU coverage is about `0.497403`, while WebGL/WebGPU varying coverage is about `0.500201` / `0.500200`. All three triangle diagnostics include the pixel and both cap-plane signs are strictly inside. **This is a body-coverage/interpolation failure, not a missing cap fragment.** It retains one CPU-color rejection across all six input variants, so successful ID checks cannot approve it.

**Consequence for migration:** a fragment-only coverage patch cannot recover cap pixels for which no invocation exists. A future common cap rule would need a conservative carrier and explicit shader clipping, followed by the same production/CPU/color checks. Where production WebGL and the declared CPU boundary disagree, a WebGPU change alone cannot make all three images identical. Keep that conflict visible rather than silently changing the reference. This bounded investigation is complete; retain the boundary blockers and extend feature coverage with curved solid links before patterns, arrows and state styling. No alternative renderer is promoted, and the normal matrix remains **30/40**.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Straight-link rendering and picking**.
2. Start with the visible-footprint candidate and ribbons. Move over either canvas to read the same device pixel in both captured ID images. These pointer events use frozen readback and do not measure production hover latency.
3. Switch to the production picking rule to inspect its width allowance and invisible-pick count. Color bytes must remain unchanged. Compare overlap in both orders, fractional boundaries, widths/defaults, blending, opacity and both pixel ratios.
4. Run the 40-case sweep. All rows remain expanded, including failures. Cancellation finishes the current row and retains partial data; the live canvases/settings are unchanged.
5. Select **Replay hard-edge coverage** for the nine isolated method comparisons and float values. Every row includes full-frame ID/mask/color failures, original-color changes and invisible picks. Cancellation keeps completed rows and preserves live canvases/settings. These are three isolated sources, not a new full-graph or 40-case acceptance claim.
6. Select **Replay caps and fractional raster** for the 48-row sensitivity study. Read the original samples, identical-vertex carrier replay and endpoint-reversal tables. Every failed pixel, captured quad, input variant and device record exports locally; cancellation preserves completed rows and the live canvases/settings.
7. Export JSON locally for raw inputs, NaN sentinels, settings, browser/device, timestamps, first failures, all controls and both diagnostic replays. Measurement JSON is not committed. NaN channel sentinels export as the string `NaN`.
8. Run `LAB_NATIVE_GPU=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links` and open the printed session in Codex's inline browser.

Curved geometry, patterns, arrows, gradient transitions, visibility-distance fading, highlight states, interrupted updates/transitions, pointer-window scheduling, full Graph/deck embedding, native portability and rendering cost remain separate gates. Large simulation counts and minimal spring-demo lines do not validate these rendering features.
