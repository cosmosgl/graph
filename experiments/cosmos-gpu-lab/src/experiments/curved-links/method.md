# Curved solid links: method and findings

Can Cosmos preserve its actual curved-link geometry, color and picking when moving from WebGL to luma WebGPU?

This experiment renders frozen links through unmodified production GLSL and a WGSL port, using public luma APIs only. It does not replace the production renderer or its padded host-picking policy. Straight-link boundary failures remain open in their own experiment.

## Recorded result · 15 November 2026

**The candidate passes 26/64 configurations on Apple M3 in Codex inline Chromium 157.** This is 18/56 nonzero-opacity cases and all 8 opacity-zero cases. Blended and hard modes each pass 13/32. All 64 preserve the original color bytes exactly within each backend; no invalid source IDs occur. The padded production control passes only its eight opacity-zero cases under the visible-image acceptance rule. It remains deliberately unchanged.

| Fixture | Candidate passed / checked | What remains rejected |
| --- | --- | --- |
| Bows | 4 / 16 | Default/inverse boundary pixels, sampled caps, chord ties and DPR 2 |
| Overlap | 10 / 16 | CPU boundaries in coarse/high-bow/zoomed profiles |
| Width/default/degenerate limits | 8 / 16 | Chord ties, high-bow CPU boundaries and folded-ribbon invisible picks |
| Fractional coordinates | 4 / 16 | CPU boundaries; two cross-GPU ID pixels at DPR 2 |

The strict counters overlap: **10 rows** have cross-GPU ID differences; **36** have a CPU mask failure in at least one backend; **5 hard-mode rows** exceed the cross-GPU color budget; **4** expose invisible candidate picks. All blended cross-GPU colors stay within 2/255, which does not erase their mask failures.

For the default blended bows, WebGL and WebGPU colors pass the budget and both avoid invisible candidate picks. Pixel **(352, 85)** is the first rejection: one WebGL ID/mask difference, while WebGPU matches the CPU mask. That is a retained boundary witness, not yet a proven arithmetic root cause.

The limits fixture exposes a separate rendering/picking policy problem. At DPR 2, each backend selects **5 invisible source pixels**; with zoom 0.5 and constant screen width, each selects **69**, in both blended and hard modes. The latter profile can match cross-GPU IDs, CPU masks and color while still failing visibility. A short 30-unit chord with width 48 folds its tessellated ribbon: color culls back faces while host IDs do not. The selected-source checks keep these failures visible even over other opaque links. An isolated-source regression covers this geometry. Culling or eligibility changes must be evaluated as a separate candidate with original color preserved.

The original **40 straight-link result rows reproduce identically at 30/40** after sharing the production WebGL adapter. No production source, previous acceptance contract or tolerance changed.

**Next:** isolate the folded-ribbon source and the default-bow boundary witness. Do not turn color agreement, safe interior picks or matching GPU masks into full acceptance. Patterns, arrows and remaining link states follow this bounded solid-curve study.

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

The **production control** retains its five-CSS-pixel wider host IDs. The **visible-footprint candidate** uses the color ribbon width. In blended mode, its source alpha must round to a nonzero RGBA8 byte as well as pass the original half-coverage cutoff. The color shader and blending remain unchanged. Hard opaque mode preserves the original positive-alpha-to-opaque behavior.

Picking is checked against the final image and against the selected link rendered in isolation. An opaque background must not hide a pick from an invisible foreground source. Unknown IDs fail separately. Folded, back-facing triangles can also expose a color/picking disagreement; the experiment records this rather than silently changing production culling.

## Acceptance and CPU reference

The existing gate is unchanged: exact IDs and scalar masks at every pixel, at most two RGBA8 channel levels of color error, and no picked pixels with zero rendered alpha. Original color preservation is exact within each backend when switching picking rules. Every selected source is checked for visibility.

The independent CPU reference evaluates the sampled rational curve and finite-difference normals, assembles the alternating triangle-strip winding, applies pixel-center/top-left coverage, interpolates the original side varying, and blends each front-facing color primitive into RGBA8. Picking uses its own padded or unpadded mesh with the production no-cull policy. It does not consume GPU masks, captured GPU vertices or readbacks as expectations. Precision and raster-boundary failures remain failures; no epsilon or excluded pixels are introduced.

GPU edge ownership can differ on exact boundaries; [WebGPU's polygon rasterization rules](https://www.w3.org/TR/webgpu/#polygon-rasterization) explain the portability limit. That is a possible explanation to investigate, not permission to waive the gate.

## Reproduce

Run `pnpm install`, then `pnpm --filter @cosmos.gl/gpu-lab dev`. Open `#/curved-links` on the printed local address in a WebGPU-capable browser.

Inspect both picking rules and pointer IDs. Run **Run curved-link sweep**: 4 fixtures × 8 profiles × blended/hard modes = **64 configurations**. Profiles include defaults, coarse/fine tessellation, inverse bow, zero bow, DPR 2, zoomed constant width/partial opacity/reversed order, and zero opacity. These are paired profiles rather than a full Cartesian product. All settings remain visible. The offscreen sweep preserves the live graph and supports cancellation between rows.

**Export JSON** retains parameters, fixtures, devices, browser, timestamp, every counter and rejected row. Measurement exports stay local and are not repository artifacts. NaN default sentinels are serialized as the string `NaN`.

Focused native tests can be run with:

```sh
LAB_NATIVE_GPU=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/curved-links
```

Open the printed Vitest session URL in Codex's inline browser. Device selection must be verified there; the environment flag alone does not select hardware for an inline session.

## Scope and limits

This first experiment covers solid curves with positive rational weights and bounded geometry. Coincident endpoints retain the original production normalization ambiguity; an empty observation is not a portable contract. Patterns, arrows, endpoint gradients, distance fading, highlights, transitions, pointer scheduling, full Graph/host integration, GPU timing and broader native hardware remain unvalidated.
