# Implementation

## Resource ownership

The experiment owns one WebGL device and one WebGPU device. Navigating away calls `destroy()` on the experiment, which
stops its timer and destroys every backend-owned GPU resource.

```mermaid
flowchart TD
  S[Lab shell] --> E[Center-mass instance]
  E --> T[Tick coordinator]
  E --> GL[WebGL backend]
  E --> GPU[WebGPU backend]
  GL --> GLC[Canvas and WebGL resources]
  GPU --> GPUC[Canvas and WebGPU resources]
  E -->|destroy| GL
  E -->|destroy| GPU
```

The lab shell knows only how to create and destroy an experiment. Controls, point state and backend comparison remain
inside the experiment package.

## luma.gl boundary

Both devices and all GPU operations use luma.gl v10 APIs. WebGL uses `Model`, vertex buffers,
`UniformStore` and a 1×1 float framebuffer; WebGPU uses `Kernel` reductions and `RenderKernel`
drawing. The CPU reads results through luma buffer/texture readback. No native handles are used.

## Buffers

The WebGPU path allocates:

| Resource | Contents | Usage |
| --- | --- | --- |
| Position buffer | `8192 × vec2f` | storage, copy destination |
| Partial buffer | `32 × vec4f` | storage |
| Result buffer | `1 × vec4f` | storage, copy source |
| Readback staging | managed by luma `Buffer.readAsync` | transient readback |
| Parameter buffers | counts and padding | uniform, copy destination |
| Center uniforms | center and pixel size | uniform, copy destination |

The position buffer is shared by compute and point rendering within the WebGPU backend. No CPU-side repacking is
required between those operations.

## Shaders

GLSL and WGSL are stored as separate files and imported through Vite's `?raw` query. This makes shader differences
reviewable while keeping the runtime API a plain string.

## Experiment discovery

The lab discovers `src/experiments/*/experiment.ts` through Vite `import.meta.glob`. Each manifest remains lightweight;
the actual demo and documentation pages are loaded only when selected.
