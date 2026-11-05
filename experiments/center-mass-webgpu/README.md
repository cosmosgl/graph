# WebGL/WebGPU center-of-mass experiment

This workspace compares two ways to calculate the global center of mass for the
same 8,192 moving `float32x2` points:

- **WebGL2:** the current Cosmos pattern. Every point renders one contribution
  into a 1×1 `RGBA32F` framebuffer and fixed-function `ONE + ONE` blending sums
  `(x, y, 1, 0)`.
- **WebGPU:** two compute dispatches. Workgroups first reduce points into partial
  `vec4f` sums, then one workgroup reduces the partials into the final
  `(sumX, sumY, count, 0)` value.

Both devices are created through the luma.gl v10 adapters. The experiment uses
their underlying WebGL2 and WebGPU handles deliberately so the compared GPU
algorithms stay explicit and independent of higher-level model helpers.

## Run

From the repository root:

```sh
pnpm --filter @cosmos.gl/experiment-center-mass-webgpu dev
```

Then open the URL printed by Vite. Use **Step** for a tick-at-a-time comparison
or **Play** for continuous ticks.

## Version pins

The v10 prerelease is not currently published at one uniform latest alpha
number: core and engine have moved beyond the backend packages. Mixing their
latest tags produces incompatible TypeScript surfaces. This experiment pins the
coherent `10.0.0-alpha.4` family for core, engine, shadertools, WebGL and WebGPU.
The workspace also pins TypeScript 7 because this luma alpha's math types
reference the `es2025.float16` standard library, which TypeScript 5.9 does not
ship.

## Reading the timing

The displayed time intentionally includes position upload, GPU execution,
synchronization, result readback and drawing. It verifies tick-by-tick behavior;
it is not a pure GPU kernel benchmark. A proper performance comparison should
use timestamp queries and avoid reading the result back every tick.

The WebGL path requires `EXT_color_buffer_float` and `EXT_float_blend`. The
WebGPU reduction requires only core WebGPU compute and `f32` storage buffers.
