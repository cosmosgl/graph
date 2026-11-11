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
- Sequences as `flow` fences, ownership as nested lists, and source-controlled SVG figures where shape matters.
- Concise Markdown findings with measurement conditions, limitations and reproduction steps.
- Backend-local shaders and resources, accessed through luma.gl APIs only.

Use `Model` / `UniformStore` for GLSL, `Kernel` / `RenderKernel` for WGSL, and luma resources,
passes, fences, readback and query sets. Do not access native device handles or create native GPU
objects, including in diagnostics and tests. Shared helpers live in `src/gpu/`. `typecheck` runs a
source boundary check as well as TypeScript. Canvas 2D remains appropriate for CPU visualizations.

The current implementation uses the pinned luma `10.0.0-alpha.4` APIs throughout. Historical native-API
measurements remain observations of that earlier implementation; rerun benchmarks before comparing
current performance. New JSON exports identify the GPU API implementation.

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
- `many-body-grid`: production hierarchical global repulsion versus WebGPU and CPU, with independent grid/sample builds,
  strict port checks and separate exact-reference approximation metrics.
- `many-body`: exact global repulsion using production GLSL, direct/tiled WGSL and an independent CPU reference,
  with batched fixed-input force/integration timing across point counts.
- `weighted-links`: Cosmos directional springs, stable topology CSR and luma compute-to-render integration.
- `repulsion-trajectories`: independent hierarchical-repulsion trajectories, local correctness and accumulated drift.
- `combined-layout`: gravity, hierarchical repulsion, directional springs and cooling, with checkpoint validation and failure replay.
- `resident-layout`: GPU bounds and composed compute-to-render ticks compared with the staged precision reference.
- `point-capacity`: same-device point-count changes, GPU prefix preservation, update costs and buffer cleanup.

Reference pages cover the lab architecture, WebGPU vocabulary and parallel reduction.
Start with **How WebGPU works** (`#/learn`) for a guided introduction with five interactive teaching models.
These use DOM/SVG and JavaScript, require no GPU and make no performance claims.

## Interactive documentation

The learning guide lives in `src/docs/learn-webgpu.md`; its small interactive examples live in
`src/app/learning-examples.ts`. An `example` fence contains a registered example name, such as
`invocations` or `pingPong`. The page passes an explicit example registry to the Markdown renderer;
unregistered fences remain ordinary code blocks. Markdown HTML stays disabled.

Keep explanations in Markdown and behavior in the example module. Models use local DOM listeners,
without timers or global listeners, so removing the page releases them. Add explicit lifecycle cleanup
before introducing animations, observers or GPU resources. Chapter links support direct opening
(`#/learn/8`); in-page chapter jumps preserve example state.

Run the documentation interaction checks with:

```sh
pnpm exec vitest run --project gpu-lab src/app/learning-examples.test.ts src/app/flow.test.ts
```

## GPU regression checks

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

This runs rendering, reductions, neighborhood-force, shared-grid, weighted-link and global many-body tests in Chromium with its software WebGPU
adapter enabled. It fails if no adapter is available. The normal repository test run skips GPU
cases when WebGPU is unavailable. The root test configuration uses separate engine and lab projects so
Vite does not resolve the lab's luma v10 imports through the engine's v9 dependency cache. Software-adapter
timings are not hardware benchmarks.

## Original comparison

`center-mass` compares two ways to calculate the global center of mass for the same 8,192 moving `float32x2` points:

- WebGL2 renders all contributions into a 1×1 `RGBA32F` framebuffer with additive blending.
- WebGPU performs a two-stage compute reduction through storage and workgroup memory.

The luma.gl dependencies are pinned to the coherent `10.0.0-alpha.4` family because newer prerelease package versions
were not published in lockstep when the experiment was created.

## Documentation flows

Use a `flow` fence for ordered steps. Each nonempty line is one step; ` · ` separates
its name from optional detail. Labels are plain text (no inline HTML or Markdown).
Vocabulary previews work just as they do in prose.

```flow
Pass 0 · points → A
Pass 1 · A → B
Pass 2 · B → A
Submit · One command buffer; the result stays in A
```

Use ` | ` between sibling paths on one line. A row before them is the shared input;
a row after them is the join. Omit the last row if the paths end independently.
These columns express relationships, not a promise of concurrent GPU execution.
Keep dependencies explicit in the labels; use a real graph if the relationships
cannot be expressed faithfully this way.

```flow
Shared positions for tick N
WebGL · Blend into a texture | WebGPU · Reduce partial buffers | CPU · Reference center
Compare centers · Errors and timings
```

`flow row` lays short sequences horizontally on wide screens and vertically on
small screens. Use ordinary nested Markdown lists for ownership, and an SVG with
an accessible description when geometry teaches something (such as the reduction
tree). Keep SVG figures source-controlled and provide descriptive alternative text.
