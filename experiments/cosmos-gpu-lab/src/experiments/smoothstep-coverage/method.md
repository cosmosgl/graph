## The question

**Can a small change to the line-edge formula make WebGL and WebGPU draw the
same pixels?** This experiment tests that question on one line. It does not
change the production renderer or settle the larger straight-link investigation.

## Why a tiny difference can be visible

Imagine a line crossing a pixel. The renderer calculates a coverage score:
`1` means fully covered; `0` means empty. With a blended edge, a score near
`0.5` makes a partly transparent pixel. With a hard edge, Cosmos uses `0.5` as
the cutoff: a score at or above it draws the pixel; a lower score leaves it empty.

For the width-3 line in the earlier M3 replay, one pixel had scores `0.5` in
WebGL and about `0.4999998` in WebGPU. The numbers are almost identical, but
the hard-edge decision is different. The [straight-link investigation](#/straight-links)
contains the original fixtures, full-frame results and the separate cap study.

## Two ways to describe the fade

The current solid-line shader uses the first expression. The experiment compares
it with the second:

```glsl
// Current: the first limit is higher.
smoothstep(0.5, 0.5 - smoothing, abs(pos.y))

// Revised: the limits ascend, and subtraction reverses the result.
1.0 - smoothstep(0.5 - smoothing, 0.5, abs(pos.y))
```

When the limits are distinct, the expressions describe the same intended curve
in real-number arithmetic. Computer arithmetic can still produce different
results. If the limits become equal after rounding, the revised expression also
needs a separate guard; this experiment uses a smoothing value of `0.25` for
the fixed-input check.

The distinction matters because [GLSL ES](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf#page=97)
does not define `smoothstep` when the first limit is greater than or equal to the
second. That applies to the current WebGL expression. [WGSL](https://www.w3.org/TR/WGSL/#smoothstep-builtin),
used by WebGPU, describes the descending case when the limits are unequal.
Undefined does not mean the WebGL shader necessarily looks wrong: it means its
result is not guaranteed. The earlier M3 measurements do not establish that
this specification issue caused the observed mismatch.

## How can the same pixel have two positions?

There are two kinds of position here. **The screen pixel is the same.** The
different number says where that pixel lies *inside the line's rectangle*.
The rectangle has `+0.5` on one side and `−0.5` on the other; the renderer
fills in values between its corners. This is called interpolation.

For a simple example, suppose the rectangle runs from screen y = `93` to
`97`, and the pixel center is at y = `96.5`. It is `3.5` pixels down a
four-pixel rectangle:

```text
top of rectangle     y = 93      position in line = +0.5
                                ↓ 3.5 out of 4 pixels
pixel center         y = 96.5    position in line = −0.375
bottom of rectangle  y = 97      position in line = −0.5
```

Both renderers are aiming for the same answer. The line is drawn as two
triangles, and the value at a pixel is filled in from the three corners of
its triangle. Small rounding differences during that calculation can put the
result on different sides of a hard cutoff. The exact algorithm used inside a
driver is not visible to this test. [WebGPU's specification](https://www.w3.org/TR/webgpu/#machine-specific-artifacts)
explicitly notes that interpolation precision can vary between implementations.

Select **Trace the pixel** under Diagnostics to give both renderers the same
saved corners and inspect the resulting positions. The trace uses the original
hard line regardless of the movement and blending controls above. It also tries
different line lengths and shows a small numerical example of how two ways of
doing the same math can round differently. That example illustrates a possible
mechanism; it is not a reconstruction of the driver's private code.

## What the two checks show

1. **Same numbers:** each backend receives three identical float32 positions:
   the edge value `0.375` and the nearest float32 value on each side. The small
   GPU programs report the score for each formula. This removes line geometry
   and interpolation from the check.
2. **Actual line:** each backend draws the isolated width-3 line twice. The
   enlarged image marks pixel `(100, 96)`. The table records its interpolated
   position and score from a separate float probe, alongside the ordinary color
   and visible-footprint ID draws. The full-frame counts show what changed when
   the formula changed on each backend.

Move the line by `1/1024` device pixel or switch between hard and blended edges
to explore nearby inputs. These moves test sensitivity; they do not correct
the original input. The visible-footprint picker is the lab candidate, not the
production padded picking policy. In blended mode, some painted fringe pixels
are intentionally outside the candidate's half-coverage contour.

## How to read a result

- If the same inputs give different scores, inspect the expression and shader
  compilation. A separate small program is evidence, not proof of how the
  production program was compiled.
- If the same inputs agree but the line does not, compare the positions supplied
  by the line shaders. Geometry, clipping and interpolation may contribute.
- If the revised formula reduces a difference, also check its color and ID
  changes. A closer match to the other backend is not the same as preserving
  each backend's original image.
- If both formulas happen to agree, the original WebGL expression remains
  outside the GLSL guarantee. One device cannot establish portability.

The original exact straight-link gates and their historical `30/40` result stay
unchanged. This experiment has no production acceptance verdict. It does not
test cap ownership, arrows, patterns, performance, full Graph interaction or
other devices. A fragment formula cannot restore a pixel that the triangle
rasterizer did not generate.

## Try it

Select **Run comparison**, then inspect the four enlarged images and the two
tables. The first table reports scores from fixed input; the second reports the
actual line's pixel and the number of changed colors and IDs. **Export JSON**
saves the inputs, browser, device, scores and comparison counts locally.
