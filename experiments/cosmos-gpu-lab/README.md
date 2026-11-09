# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, Markdown findings and GPU-resource
lifecycle.

Follow the **WebGPU migration** roadmap (`#/roadmap`) for Cosmos migration readiness, demonstrated capabilities,
remaining gaps and the evidence needed for a production switch.

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
- Concise Markdown findings with measurement conditions, limitations and reproduction steps.
- Backend-local shaders and resources.

## Recording findings

Commit the knowledge: what was tested, why, the environment and implementation variant, a small results table,
limitations, and the exact controls or commands needed to reproduce the comparison. Timings vary across machines;
they are local observations, not expected values for every GPU.

Keep **Export JSON** in benchmark demos for local analysis. Routine measurement JSON and ZIP archives stay outside
Git; use the ignored `captures/` directory if you want to keep exports inside the lab folder. Small deterministic
fixtures needed to reproduce correctness bugs belong with tests, separately from benchmark captures.

## Experiments

- `center-mass`: tick-by-tick WebGL/WebGPU correctness comparison.
- `scalable-reduction`: GPU-resident hierarchical reduction at larger point counts.
- `point-rendering`: WebGL point sprites and WebGPU instanced circle quads.
- `performance-lab`: matched rendering and reduction benchmarks.
- `spatial-grid`: count, scan and scatter into a CSR-style spatial index.
- `neighborhood-forces`: tiled all-pairs versus grid-based local repulsion, integration and rendering.

Reference pages cover the lab architecture, WebGPU vocabulary and parallel reduction.

## GPU regression checks

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

This runs the neighborhood-force and shared-grid tests in Chromium with its software WebGPU
adapter enabled. It fails if no adapter is available. The normal repository test run skips GPU
cases when WebGPU is unavailable. Software-adapter timings are not hardware benchmarks.

## Original comparison

`center-mass` compares two ways to calculate the global center of mass for the same 8,192 moving `float32x2` points:

- WebGL2 renders all contributions into a 1×1 `RGBA32F` framebuffer with additive blending.
- WebGPU performs a two-stage compute reduction through storage and workgroup memory.

The luma.gl dependencies are pinned to the coherent `10.0.0-alpha.4` family because newer prerelease package versions
were not published in lockstep when the experiment was created.
