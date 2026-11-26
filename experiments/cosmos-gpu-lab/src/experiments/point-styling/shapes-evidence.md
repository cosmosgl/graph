# How point shapes work

WebGL draws each point as a square sprite (`GL_POINTS`). The shader uses hardware-interpolated
`gl_PointCoord` to decide how much of each pixel the shape covers and whether a click hits it.
WebGPU draws a quad with six vertices, padded by one device pixel on each side. Its shader subtracts
the point center from the pixel center, clips to the sprite bounds, then evaluates the shape.

## Fractional positions and sizes

At **1× pixel ratio**, a requested `gl_PointSize` of 13.3 device pixels produced a coordinate span
of 13.25 on Apple M3 with Metal. That shift can change an edge pixel’s opacity or which point a
click picks. WebGPU uses the requested diameter. Its picks match the CPU’s calculated outline for these circles in **Closed** mode.

At **2× pixel ratio**, choose **Fractional sizes** and **1× zoom**, then inspect pixel **(630, 120)**.
Its center falls exactly on the circle’s top edge. WebGL’s half-open sprite bounds exclude the top
and right edges, so WebGL picks background. With **WebGPU bounds** set to **Closed**, WebGPU includes
the edge and picks point 2. The padding lets the shader evaluate that pixel at the original diameter.

## One-device-pixel boundary check

More than one device pixel from the outline, both renderers must pick exactly the point the CPU
predicts, and each color and alpha channel must agree within 2/255. WebGPU must keep thin points
visible, and fully transparent pixels must return background in both previews. Moving subpixel circles,
other GPUs and exact polygon-edge ties still need testing. See circle rendering and picking in the [integrated graph](#/integrated-webgpu).
