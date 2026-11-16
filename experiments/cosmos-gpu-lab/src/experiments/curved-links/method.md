# Curved solid links: method and findings

Can Cosmos preserve its actual curved-link geometry, color and picking when moving from WebGL to luma WebGPU?

This experiment renders frozen links through unmodified production GLSL and a WGSL port, using public luma APIs only. It does not replace the production renderer or its padded host-picking policy. Straight-link boundary failures remain open in their own experiment.

## Recorded result · 15 November 2026

**The color-face candidate passes 28/64 configurations on Apple M3 in Codex inline Chromium 157.** This is 20/56 nonzero-opacity cases and all 8 opacity-zero cases. Blended and hard modes each pass 14/32. All 64 preserve original color bytes exactly within each backend and have zero invisible frame/source picks or invalid source IDs. The 36 rejected configurations remain rejected under the original criteria.

The previous visible candidate remains available unchanged at **26/64**, including its four invisible-source failures. Every field of its 64 exported result rows, including the production and CPU comparisons, reproduced identically. The padded production control still passes only its eight opacity-zero rows under the visible-image rule. Its deliberate padding is a separate policy, not a WebGPU implementation defect.

| Fixture | Color-face passed / checked | Previous visible passed | Remaining color-face failures |
| --- | --- | --- | --- |
| Bows | 4 / 16 | 4 | Default/inverse boundary pixels, sampled caps, chord ties and DPR 2 |
| Overlap | 10 / 16 | 10 | CPU boundaries in coarse/high-bow/zoomed profiles |
| Width/default/degenerate limits | 10 / 16 | 8 | Chord ties, high-bow and DPR 2 CPU boundaries |
| Fractional coordinates | 4 / 16 | 4 | CPU boundaries; two cross-GPU ID pixels at DPR 2 |

The strict counters overlap: **10 rows** have cross-GPU ID differences; **36** have CPU mask failures; **5 hard-mode rows** exceed the cross-GPU color budget. All blended cross-GPU colors stay within 2/255, which does not erase their mask failures. Original colors, the exact-mask rule and the numeric color budget have not changed.

The original **40 straight-link rows reproduced identically at 30/40** when the curve adapter was introduced; the shared adapter and straight diagnostic tests also pass after this investigation. This experiment does not resolve the straight-link blockers.

## Folded-ribbon picking investigation

A short 30-unit chord with width 48 can fold the tessellated ribbon back over itself. The production color pipeline culls back-facing triangles; the host ID pipeline accepts both orientations. Its visible-width candidate inherited that difference. Some triangles therefore wrote IDs where their own source contributed no color. Source-byte eligibility cannot fix a triangle that the color pass never draws.

The separate **color-face candidate** changes only the ID pipeline's `cullMode` to `back`, matching color. It retains the same visible-width geometry, source-byte eligibility, draw order, coverage cutoff and original color pass. The original padded control and previous two-sided candidate are still selectable. [luma's pipeline parameters](https://luma.gl/docs/api-reference/core/parameters#assembly-culling) expose this state through the public API; see also [WebGPU primitive state](https://www.w3.org/TR/webgpu/#primitive-state).

The CPU adds an independent front-face ID mask for this separate policy. Its previous padded/two-sided masks and color calculations are untouched. This describes the candidate's intended behavior; it does not substitute GPU readbacks for expectations or relax a threshold.

| Limits profile | Previous invisible source pixels per backend | Color-face invisible pixels | Full acceptance |
| --- | --- | --- | --- |
| DPR 2 · blended and hard | 5 | 0 | Both rejected: 4 CPU mask differences per backend remain |
| Zoom 0.5, constant width, opacity 0.35, reversed · blended and hard | 69 | 0 | Both pass all existing gates |

These cover four matrix rows. A separate isolated-source test verifies the folded ribbon in both APIs, both modes and DPR 1/2, including restoration of the original images after switching policies. In the full matrix, every selected source is rendered in isolation: all 64 color-face cases have zero invisible-source picks, even when opaque links could otherwise hide an invisible foreground ID.

## Default bow boundary investigation

The default blended bow first disagrees at **(352, 85)** on the amber link. Isolating that source relabels it from full-fixture link 1 to link 0. Unmodified color and original visible-ID images are captured before and after diagnostics to check restoration.

Unblended float targets record the actual interpolated ribbon side, smoothing, coverage and source ID. A point-list pass captures every post-vertex clip coordinate. The pixel falls inside triangle 11; captured-geometry double interpolation and the independent CPU mask put it inside the half-coverage boundary. Both native probes use smoothing **0.1111111119389534**.

| Path | Interpolated side | Coverage | ID at cutoff 0.5 |
| --- | --- | --- | --- |
| WebGL native | −0.4444517195 | 0.4999017715 | Background |
| WebGPU native | −0.4444278479 | 0.5002240539 | Link 0 |
| WebGPU explicit linear interpolation | −0.4444278479 | 0.5002240539 | Link 0 |

To separate curve construction from interpolation, the replay feeds **identical float32 clip coordinates and side/ramp values** to both rasterizers. It uses three geometry sources: the WebGL capture, WebGPU capture and CPU-rounded geometry. Each source runs through WebGL, WebGPU and WebGPU with explicit linear interpolation: **nine rows**.

All nine reproduce their backend's native carrier and cutoff masks exactly across the isolated framebuffer. At the witness, all three geometry sources reproduce the same WebGL-versus-WebGPU split above. There are small native vertex differences, but they are not necessary to produce this rejection. Explicit linear interpolation does not fix it. The evidence isolates an API-path interpolation/raster difference on this M3; it does not identify a particular driver instruction or establish identical behavior on other devices. [WebGPU polygon rasterization](https://www.w3.org/TR/webgpu/#polygon-rasterization) is the specification context, not a waiver of the gate.

Both blended colors at this pixel are **RGBA8 (76, 54, 31, 89)**, with a nonzero source alpha byte. Source-alpha quantization is not the cause. In hard mode WebGL discards the pixel, leaving **(0, 0, 0, 0)**, while WebGPU renders **(217, 153, 89, 255)**. That color rejection remains.

Changing IDs alone cannot make both hard colors agree or select WebGL's invisible pixel. A shared explicit coverage/color algorithm would be a separate rendering candidate, and would still have to preserve original colors under the existing gate. No epsilon, pixel exclusion, tolerance change or production shader edit is introduced here.

**Next:** retain these exact-mask/color blockers while extending the bounded rendering comparison to endpoint gradients, then patterns, arrows and link states. A common explicit coverage renderer remains a separate diagnostic direction, not an accepted substitute for the production reference.

## The production curve

Cosmos draws a tessellated rational quadratic ribbon. The defaults are **19 segments**, **weight 0.8** and **control-point distance 0.5**. For endpoints A and B, the control point C is the midpoint displaced along the perpendicular by `length(B − A) × controlDistance`. Reversing endpoints reverses the bow.

```text
P(t) = ((1−t)² A + 2(1−t)t w C + t² B)
       / ((1−t)² + 2(1−t)t w + t²)
```

Samples are not uniform in t. Production uses a signed power scale with exponent 2:

```text
s = 2i / segments − 1
t = (1 + sign(s) × s²) / 2
```

Each sample supplies two ribbon vertices, with sides +0.5 and −0.5. Both GPU paths receive the actual production float32 geometry. The CPU reconstructs these samples independently. See [D3's power-scale definition](https://d3js.org/d3-scale/pow).

Normals use `P(min(t + 1/segments, 1)) − P(max(t − 1/segments, 0))`, then a perpendicular normalization. These are neither analytic derivatives nor differences between adjacent power-spaced samples. One segment therefore draws the endpoint chord, regardless of bow settings.

```flow
Endpoints and source styles · identical uploaded float32 inputs
Rational curve samples · production power-spaced geometry
Finite-difference normals · ribbon extrusion, width and zoom cap
Triangle strip · original color draw and separate ID pass
Full-frame comparison · WebGL, WebGPU and independent CPU rasterizer
Selected-source visibility · isolate every source that contributed a picked ID
```

## Color and picking

Color retains the production smoothing ramp, subpixel attenuation, alpha, source-over blending and hard-edge behavior. Color culls back faces; host picking draws both orientations. Short, wide or strongly bent ribbons can fold, so a curve is not simply a stroked mathematical line.

The **production control** retains its five-CSS-pixel wider host IDs. The **previous visible-footprint candidate** uses the color ribbon width. The **color-face candidate** also matches the color pass’s back-face culling. In blended mode, its source alpha must round to a nonzero RGBA8 byte as well as pass the original half-coverage cutoff. The color shader and blending remain unchanged. Hard opaque mode preserves the original positive-alpha-to-opaque behavior.

Picking is checked against the final image and against the selected link rendered in isolation. An opaque background must not hide a pick from an invisible foreground source. Unknown IDs fail separately. Folded, back-facing triangles can also expose a color/picking disagreement; the experiment records this rather than silently changing production culling.

## Acceptance and CPU reference

The existing gate is unchanged: exact IDs and scalar masks at every pixel, at most two RGBA8 channel levels of color error, and no picked pixels with zero rendered alpha. Original color preservation is exact within each backend when switching picking rules. Every selected source is checked for visibility.

The independent CPU reference evaluates the sampled rational curve and finite-difference normals, assembles the alternating triangle-strip winding, applies pixel-center/top-left coverage, interpolates the original side varying, and blends each front-facing color primitive into RGBA8. Picking uses its own padded or unpadded mesh: production/previous visible IDs keep both faces, while the color-face mask keeps the color-facing triangles. It does not consume GPU masks, captured GPU vertices or readbacks as expectations. Precision and raster-boundary failures remain failures; no epsilon or excluded pixels are introduced.

GPU edge ownership can differ on exact boundaries; [WebGPU's polygon rasterization rules](https://www.w3.org/TR/webgpu/#polygon-rasterization) explain the portability limit. That is a possible explanation to investigate, not permission to waive the gate.

## Reproduce

Run `pnpm install`, then `pnpm --filter @cosmos.gl/gpu-lab dev`. Open `#/curved-links` on the printed local address in a WebGPU-capable browser.

Inspect all three picking rules and pointer IDs. Run **Run curved-link sweep**: 4 fixtures × 8 profiles × blended/hard modes = **64 configurations**. Profiles include defaults, coarse/fine tessellation, inverse bow, zero bow, DPR 2, zoomed constant width/partial opacity/reversed order, and zero opacity. These are paired profiles rather than a full Cartesian product. All settings remain visible. The offscreen sweep preserves the live graph and supports cancellation between rows.

**Replay default-bow pixel** runs the fixed nine-row investigation without changing the live graph or its settings. It retains native float witnesses and exact vertex values for local export; all nine rows stay visible.

**Export JSON** retains parameters, fixtures, devices, browser, timestamp, every counter and rejected row, plus boundary replay data. The schema is version 2; the old comparison fields remain present. Measurement exports stay local and are not repository artifacts. NaN default sentinels are serialized as the string `NaN`.

Focused native tests can be run with:

```sh
LAB_NATIVE_GPU=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/curved-links
```

Open the printed Vitest session URL in Codex's inline browser. Device selection must be verified there; the environment flag alone does not select hardware for an inline session.

## Scope and limits

This first experiment covers solid curves with positive rational weights and bounded geometry. Coincident endpoints retain the original production normalization ambiguity; an empty observation is not a portable contract. Patterns, arrows, endpoint gradients, distance fading, highlights, transitions, pointer scheduling, full Graph/host integration, GPU timing and broader native hardware remain unvalidated.
