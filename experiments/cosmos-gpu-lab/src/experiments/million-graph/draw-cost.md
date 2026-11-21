# What costs time when drawing a million points?

## Native M3 results

The points-only pass took more GPU time than the links-only pass in all four
views. At full Fit on the wide canvas, the points-only median was **16.71 ms**,
the links-only median was **7.55 ms**, and drawing both took **28.07 ms**.
The 3× community zoom reduced the combined median to **8.58 ms** while the
renderer still submitted the full point and link counts.

| Camera and backing size | Clear GPU median | Points GPU median | Links GPU median | Both GPU median / p95 | Both completion median / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fit · 480 × 340 | 0.02 ms | 15.81 ms | 4.31 ms | 22.14 / 24.79 ms | 23.1 / 26.3 ms |
| Community zoom · 480 × 340 | 0.02 ms | 6.86 ms | 1.12 ms | 8.36 / 8.56 ms | 9.3 / 10.8 ms |
| Fit · 1922 × 1082 | 0.10 ms | 16.71 ms | 7.55 ms | 28.07 / 37.51 ms | 30.4 / 39.2 ms |
| Community zoom · 1922 × 1082 | 0.10 ms | 6.93 ms | 1.37 ms | 8.58 / 8.95 ms | 9.6 / 12.1 ms |

Every paint check passed. On wide Fit, the isolated points covered 81,142
pixels and isolated links covered 66,437. Opaque points covered every link
pixel in the combined image in all four cases. Skipping links would have
produced the same pixels on these frozen views and removed a measurable draw
cost. Moving layouts, other fixtures and production styles still need a
coverage check. The one-million-point buffers and each camera stayed bit-for-bit
stable.

Chrome 157 reported the non-fallback Apple `metal-3` WebGPU adapter, and ANGLE
identified Apple M3 on WebGL. The test used luma.gl 10.0.0-alpha.15 and valid,
within-pass timestamps for all 256 measured draws. The Vitest iframe measured
414 × 896 CSS pixels and clipped the canvas on screen. GPU timing and untimed
paint checks covered the complete backing attachments. The wall samples stop
at GPU completion and leave presentation to the moving-view experiment.

Raw timing rows, paint counts and the exact repository snapshot are in the
ignored `captures/resident-draw-cost-20261119-111247-c4pwxwd3p8/`.
The archive SHA-256 is
`e6eea5d819da5f610569bc7a5d4e34a9fc1bffed5f33d238f917711a22f0da4a`.
The base revision is `9e1ef65d46425ef4e97f81db7a74370f58bf1ba5`.
The frozen-source Lab typecheck, targeted lint and native draw test passed.

### Fully visible replay

The follow-up used a 1,280 × 900 Chrome viewport and a 1,080 × 680 test
iframe. Both canvases fit entirely at their measured CSS dimensions. It
repeated the same freeze and draw sequence. Points again took the most GPU
time in all four cases. Wide Fit took **16.18 ms** for points alone,
**6.96 ms** for links alone and **25.27 ms** for the combined draw.

| Camera and backing size | Points GPU median | Links GPU median | Both GPU median / p95 | Both completion median / p95 |
| --- | ---: | ---: | ---: | ---: |
| Fit · 480 × 340 | 15.50 ms | 4.09 ms | 19.49 / 23.90 ms | 20.4 / 24.5 ms |
| Community zoom · 480 × 340 | 6.79 ms | 1.12 ms | 8.08 / 8.18 ms | 8.8 / 9.1 ms |
| Fit · 1922 × 1082 | 16.18 ms | 6.96 ms | 25.27 / 30.71 ms | 26.1 / 31.6 ms |
| Community zoom · 1922 × 1082 | 6.99 ms | 1.37 ms | 8.49 / 8.89 ms | 9.3 / 9.7 ms |

All 256 GPU timestamps and all paint and state checks passed. The opaque
points again covered every standalone link pixel. Start the next optimization
with the cost of drawing overlapping points at Fit. The identical frozen
points-only image also gives a concrete case for later checking when links can
be skipped without a visual change.

The replay is in `captures/resident-expanded-20261119-112145-e06e8eea/`
with archive SHA-256
`3ce113757bded07fa40a21b0adaf804e4cf69ec343b87c9992bf74a4a1a593f6`.
It shares the session with the moving-view sweep and ran sequentially.

### Reduced drawing and cached highlights

```result-chart
{
  "title": "A cached highlight took under 1 ms to draw",
  "context": "Median draw completion for a selection change · Frozen million-point graph · 1,922 × 1,082 backing pixels",
  "unit": "ms",
  "bars": [["Standard redraw",25.5],["Cached highlight",0.7]]
}
```

On M3, **Reduced drawing** cut wide Fit draw time from **24.5 to 13.7 ms**
and drew **289,904** instances across both passes of the million-point graph.
The first pass draws the final eighth of the points into an integer texture.
Earlier points can be skipped when those later points cover every sample in
their projected bounds. WebGPU compacts the surviving IDs in their original
order and draws them indirectly. The count includes the coverage pass.

The renderer caches the final visible owner of each pixel on the GPU. A
selection change recolors that scene in one pass on the same canvas. Camera
or position changes rebuild the ownership texture.

| Frozen view | Standard draw median / p95 | Reduced draw median / p95 | Standard → cached highlight median |
| --- | ---: | ---: | ---: |
| Fit · 480 × 340 | 19.9 / 22.1 ms | 9.4 / 10.1 ms | 20.0 → 0.5 ms |
| Fit · 1922 × 1082 | 24.5 / 26.8 ms | 13.7 / 14.8 ms | 25.5 → 0.7 ms |
| Community zoom · 1922 × 1082 | 9.2 / 9.7 ms | 4.6 / 5.2 ms | 9.0 → 0.7 ms |

All 20 frozen lanes matched the reference pixels and pick IDs at Fit and
3× zoom, including selection replacement and clearing. The timing runs
include the coverage, compaction and presentation work through the GPU
fence. The earlier footprint-matching candidate preserved the same checks
and drew 993,339 instances at wide Fit.

The later Chrome 157 session used the non-fallback Apple WebGPU adapter
and luma 10.0.0-alpha.15. Raw data and source snapshots are in
`captures/resident-coverage-m3-cf134e46/` and
`captures/resident-render-m3-0iregzwm-a/`. The coverage snapshot SHA-256 is
`2969aac9155ce9b4686a397a50f9b33b84c5f5dc938f90e8b62342a170bae866`.
Use the recorded source snapshot with `VITE_LAB_RESIDENT_RENDER_CANDIDATES=1`
to compare drawing modes. [Moving rerun](#/million-graph?section=doc-interactive-study)

## Comparison

Freeze the persistent dense communities after 50 Four corners ticks on the
200-tick cooling schedule. Reuse those exact positions and all 999,990 links
in every measurement. Compare clear-only, points-only, links-only and both
layers in the same native WebGPU renderer. The draw order is links followed by
opaque points. All original elements still go to the GPU in their enabled
layers. Each viewport has a Fit camera and a camera zoomed three times toward
the first community at world coordinate (3200, 0).

- Use visible native Chrome on the M3. Record Apple WebGPU adapter identity
  and the WebGL renderer used to identify the hardware. The small canvas is
  480 × 340 CSS pixels at one backing pixel per CSS pixel. The wide canvas
  is 961 × 541 CSS pixels at two backing pixels per CSS pixel, so the
  attachment is 1922 × 1082.
- Warm each layer once per camera. Rotate the order in four groups and repeat
  the matched rotation four times for 16 measured draws per layer. Collect
  each render pass's own beginning and end GPU timestamps and the wall time
  through a GPU completion fence. Preserve all samples, including unavailable
  timers or interrupted runs. These draws exclude the simulation and stop at
  GPU completion.
- After timing, read the untimed canvas paint. Require nonempty points and
  links separately. Check the combined image matches point pixels over link
  pixels and the clear has the expected background. Require bitwise agreement
  with the frozen resident position buffer and the same view before and
  after drawing.

## Reproduce

Use the study’s recorded source snapshot or the archived suite at `08e5ff5d`.
Set a unique `LAB_ARTIFACT_RUN` and record the exact source revision and snapshot
with `LAB_SOURCE_REVISION` and `LAB_SOURCE_SNAPSHOT`. Stop other timing, build
and test work during the run.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_RESIDENT_DRAW_COST=1 \
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/resident-draw-cost.test.ts
```
