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

**Next gate:** isolate the hard-edge coverage rounding first, then the cap/top-left and fractional raster differences. Keep the original production shaders, scalar reference and acceptance unchanged. Broader styles can follow once these counterexamples are understood or explicitly retained as blockers. No boundary pixels are omitted and no epsilon is added.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Straight-link rendering and picking**.
2. Start with the visible-footprint candidate and ribbons. Move over either canvas to read the same device pixel in both captured ID images. These pointer events use frozen readback and do not measure production hover latency.
3. Switch to the production picking rule to inspect its width allowance and invisible-pick count. Color bytes must remain unchanged. Compare overlap in both orders, fractional boundaries, widths/defaults, blending, opacity and both pixel ratios.
4. Run the 40-case sweep. All rows remain expanded, including failures. Cancellation finishes the current row and retains partial data; the live canvases/settings are unchanged.
5. Export JSON locally for raw inputs, NaN sentinels, settings, browser/device, timestamps, first failures and all controls. Measurement JSON is not committed. NaN channel sentinels export as the string `NaN`.
6. Run `LAB_NATIVE_GPU=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/straight-links` and open the printed session in Codex's inline browser.

Curved geometry, patterns, arrows, endpoint gradients, visibility-distance fading, highlight states, interrupted updates/transitions, pointer-window scheduling, full Graph/deck embedding, native portability and rendering cost remain separate gates. Large simulation counts and minimal spring-demo lines do not validate these rendering features.
