# Implementation

## Shared input

Both renderers receive clip-space `positions` (`[x, y, ...]`) and RGBA `colors` (`[r, g, b, a, ...]`).
WebGL binds them as vertex attributes. WebGPU reads them from storage buffers indexed by `instance_index`.

## WebGL point sprite

```glsl
gl_Position = vec4(position, 0.0, 1.0);
gl_PointSize = pointDiameter;
```

The fragment shader maps `gl_PointCoord` from `[0, 1]` to `[-1, 1]` and uses
`fwidth(length(local))` to set the width of the fade just inside the edge. At small diameters, that fade can dim
much of the disc. Production Cosmos centers its smoothing ramp on the edge and measures it in device pixels.

## WebGPU instanced quad

`RenderKernel.draw` submits six vertices per point. Each vertex offsets one corner from the point’s
center, using `pixelToClip` to convert drawing-buffer pixels to clip space on each axis.

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

- **Y orientation.** The quad’s `local.y` increases upward. WebGL’s `gl_PointCoord.y` increases
  downward. Flipping Y preserves a circle’s radius but mirrors a directional image.
- **Viewport clipping.** All centers in this demo lie inside the viewport. For a wide point centered
  past a side edge, the [WebGL clipping rule](https://registry.khronos.org/webgl/specs/latest/1.0/#:~:text=Wide%20point%20primitive%20clipping)
  allows the sprite to disappear or remain partly visible. WebGPU clips each triangle individually.

## Blending and resources

Source-alpha blending mixes the point color with the color already drawn, using the point’s alpha
multiplied by edge coverage. Differences in rasterization and derivative estimates can affect edge pixels.

Dragging the diameter slider updates a uniform and redraws the circles. Regenerating the layout or
changing the point count replaces WebGL’s vertex buffers and rewrites WebGPU’s preallocated storage
buffers. Both renderers reuse their pipelines.
