# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, structured result reports and GPU-resource
lifecycle.

## Run

From the repository root:

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
```

The application uses hash routes, so experiment demos and documentation pages can be linked directly without server
rewrite configuration.

## Add an experiment

Create `src/experiments/<id>/experiment.ts` and export an `ExperimentDefinition`. Vite discovers experiment manifests
through `import.meta.glob`; the demo and documentation remain lazy-loaded.

An experiment should contain:

- An interactive demo with explicit `destroy()` cleanup.
- Markdown explaining the algorithm, implementation, correctness and limitations.
- Diagrams as Mermaid blocks or source-controlled SVG files.
- Versioned JSON reports for reproducible correctness or performance evidence.
- Backend-local shaders and resources.

## Current experiment

`center-mass` compares two ways to calculate the global center of mass for the same 8,192 moving `float32x2` points:

- WebGL2 renders all contributions into a 1×1 `RGBA32F` framebuffer with additive blending.
- WebGPU performs a two-stage compute reduction through storage and workgroup memory.

The luma.gl dependencies are pinned to the coherent `10.0.0-alpha.4` family because newer prerelease package versions
were not published in lockstep when the experiment was created.
