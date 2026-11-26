## What happened on the M3

**Changing the formula did not change the tested hard-edged line.** Both
backends still differed on 180 pixel IDs. The fixed-input check also gave the
same scores for both formulas on both backends.

This led us to investigate the position arriving at the shader, rather than
the order of the formula's limits. The original WebGL expression still lacks a
GLSL guarantee, even though it behaved as intended in these checks.

Recorded **17 November 2026**, on Apple M3 in inline Chromium 157, using ANGLE
Metal for WebGL, the Apple WebGPU adapter and luma `10.0.0-alpha.15`. The line
was isolated from the existing straight-ribbon fixture; the full 40-case sweep
was not rerun for this result.

| Check | Observation |
|---|---|
| Three identical positions near the edge | All four backend/formula combinations returned the same score for each position. |
| Original position, hard edge | Changing the formula changed **0** color pixels and **0** IDs on each backend. The two backends still differed at **180** IDs. |
| Moved down 1/1024 device pixel, blended edge | Changing the formula changed **0** color pixels and **0** IDs on each backend. The backends agreed on IDs in this run. |

For the original hard line at pixel `(100, 96)`, the float probes and ordinary
draws gave:

| Backend | Position reaching the shader | Score | Pixel |
|---|---:|---:|---|
| WebGL, either formula | `-0.375` | `0.5` | Drawn; link 1 picked |
| WebGPU, either formula | `-0.3750000298023224` | `0.4999998211860657` | Empty; background picked |

The float probes are separate programs, so they do not prove the compiler used
identical instructions for the ordinary draws. Their predicted hard decision
matches the observed pixel in this capture. The smaller fixed-input programs
also do not prove every input or device will behave the same way.

## Following the pixel's position

The screen pixel is the same in both renderers: its center is `(100.5, 96.5)`.
The differing number is the pixel's position **inside the line**, not its
position on the screen. The two line edges have values `+0.5` and `−0.5`; the
graphics pipeline fills in a value between the corners.

For the simple aligned rectangle, the pixel is `3.5` pixels down a four-pixel
rectangle. In exact math, its position is `+0.5 − 3.5/4 = −0.375`. The hard
edge lies at exactly that position. One float32 step farther out is
`−0.3750000298023224`, enough to cross the cutoff.

On the same M3, the follow-up captured the four line corners from each
renderer and replayed them using small, independent shaders:

| Check | What happened |
|---|---|
| The actual screen pixel | Both replay shaders received center `(100.5, 96.5)`. |
| The original line corners | The captured float32 corners were identical, and the rectangle was fully inside the viewport. |
| Same saved corners sent to both renderers | WebGL returned `−0.375`; WebGPU returned `−0.3750000298023224`. |
| Replay versus each original float probe | The carrier and the positions matched at every captured pixel on each backend. |
| Exactly representable corners in a 512 × 512 viewport | The same one-step difference remained. |
| The same value at every corner | Both returned `−0.375` using smooth and flat interpolation. |
| Explicit linear interpolation on WebGPU | The tested pixel still returned `−0.3750000298023224`. |

These controls point to how the rendering paths fill in a value across a
triangle, including their rasterization and numerical rounding. The difference
does not require different saved corners, clipping, or the original corner
shader for this example. The separate probe programs matched the original
probes, but they cannot expose the driver's internal implementation.

The effect also depends on the triangle's shape. With exact corners in the
512-pixel viewport, the two positions differed for **4 of 17** line lengths:
`96`, `180`, `192` and `200` pixels. The other 13 tested lengths agreed at the
sampled pixel. This is a clue, not a rule that a particular length is safe.

### A simple rounding example

The pixel in the 180-pixel control lies inside a triangle. One way to calculate
its position is to combine the corner values using the fractions `90/720`,
`478/720` and `152/720`. Two mathematically equivalent float32 calculations
can produce the two observed numbers:

| Calculation | Result |
|---|---:|
| Divide each numerator by 720 | `−0.375` |
| Round `1/720` once, then multiply each numerator | `−0.3750000298023224` |

This is an illustration of how rounding *can* cause the difference, not proof
that either driver uses that calculation. The example matched WebGPU at
**13 of 17** tested lengths; it missed `112`, `120`, `200` and `240`. That
failure is useful evidence against treating the example as the driver's exact
algorithm.

## Disposition

This focused investigation is **closed with the M3 evidence recorded**. The
same saved corners produced different positions inside the tested line, and
changing the `smoothstep` formula did not make that line match. The driver's
exact calculation remains unknown, and no production replacement was approved.

Reopen this study if a practical line or picking issue calls for a coverage
change, or if exact cross-device parity enters scope. Check other orientations,
positions and devices before choosing a change. The broader hard-edge, cap and
fractional-raster investigation remains parked; other line styles, full Graph
interaction and performance remain unassessed. The original straight-link
acceptance result and its existing failures remain unchanged.

To repeat the original-position hard-edge check and fixed-input probes on the
local GPU:

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/smoothstep-coverage/comparison.test.ts
```

Open the printed test session in the native browser. The test writes
`smoothstep-fixed-input.json` and `smoothstep-line.json` to the ignored local
captures directory. To repeat the shifted blended case, choose **Down** under
Position and **Blended** under Edge. Each choice starts a comparison.

For the position trace and its length controls, run:

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/smoothstep-coverage/position-trace.test.ts
```

The trace writes `smoothstep-position-trace.json` to the same ignored local
captures directory. It is also available through **Trace the pixel** in the
experiment.
