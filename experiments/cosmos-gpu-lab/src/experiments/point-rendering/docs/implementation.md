# Implementation

## Shared input contract

The experiment creates two flat arrays:

```text
positions = [x0, y0, x1, y1, ...]
colors    = [r0, g0, b0, a0, r1, g1, b1, a1, ...]
```

Positions are already in clip space so camera transforms do not obscure the primitive comparison.
The WebGL backend binds the arrays as vertex attributes. The WebGPU backend keeps them in two
read-only storage buffers and uses `instance_index` as the point index.

## WebGL point sprite

The vertex shader submits one position and selects the rasterized square's diameter:

```glsl
gl_Position = vec4(position, 0.0, 1.0);
gl_PointSize = pointDiameter;
```

The fragment shader converts the supplied `[0, 1]` point coordinate into a `[-1, 1]` circle
coordinate. `fwidth` estimates the screen-space derivative so `smoothstep` produces a narrow
antialiasing ramp rather than a hard, jagged discard.

## WebGPU instanced quad

The luma `RenderKernel.draw` uses `vertexCount: 6` and `instanceCount: pointCount`. `vertex_index` chooses one of six compile-time quad
corners while `instance_index` chooses the point:

```wgsl
let corner = QUAD[vertexIndex];
let pixelToClip = vec2f(2.0 / viewport.x, 2.0 / viewport.y);

output.position = vec4f(
  positions[pointIndex] + corner * diameter * 0.5 * pixelToClip,
  0.0,
  1.0,
);
output.local = corner;
```

Multiplying by `pixelToClip` makes the diameter screen-space and aspect-correct: one pixel in X
and one pixel in Y are converted independently. The local corner becomes the fragment shader's
circle coordinate, replacing `gl_PointCoord`.

## Blending

Both pipelines use source-alpha compositing:

```text
output.rgb = source.rgb × source.alpha + destination.rgb × (1 − source.alpha)
```

The shader also multiplies alpha by geometric coverage at the edge. Small differences between the
two panels may still appear because WebGL and WebGPU can choose different rasterization and
derivative details.

## Resource lifetime

WebGL uses `Model`, vertex buffers and a `UniformStore` uniform block. WebGPU uses `RenderKernel`,
storage buffers and a uniform buffer. Changing diameter updates uniforms only. WebGL replaces its
vertex buffers when data changes; WebGPU writes into capacity-checked buffers. Both retain their
pipelines. Completion measurements use luma fences. No native handles or GPU commands are used.
