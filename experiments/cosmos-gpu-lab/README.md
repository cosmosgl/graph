# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, Markdown findings and GPU-resource
lifecycle.

Follow the **WebGPU migration** roadmap (`#/roadmap`) for Cosmos migration readiness, demonstrated capabilities,
remaining gaps and the evidence needed for a production switch.

The homepage opens with the reviewed migration assessment. Collision and Combined layout pilot
**Overview / Run / Method / Evidence** navigation, keeping historical studies labeled and their
existing URLs intact. Documentation visits preserve one paused run; another experiment or Home
releases it. Run uses visible Configuration, Run, Results and Diagnostics sections. Method includes the comparison
contract. Long articles have route-preserving section links and visible contents navigation. Search
and the remaining experiment overviews are follow-up work after this pilot.

Use the **Validation workflow** (`#/validation-workflow`) and **Numerical research**
(`#/numerical-research`) for reference roles, source-backed precision findings and acceptance policy.
Every experiment has a **Validation contract** tab describing its question, reference, gates,
checked population and limits. The contract is not a live verdict.

## Run

From the repository root:

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
```

The application uses hash routes, so experiment demos and documentation pages can be linked directly without server
rewrite configuration.

## Interface palette

Keep charcoal surfaces and neutral reading text. Shared tokens in `src/app/styles.css` use pale
King’s blue (`--accent`, `#aac7e8`) for links, focus and selected controls; Naples yellow
(`--highlight`, `#f4d889`) for sparse priority/context highlights; and coral (`--danger`, `#ed695b`)
for errors, with a lighter `--danger-text` for small labels on raised surfaces. Preserve text or
structural cues alongside color, such as error messages, active underlines and context borders.

Graph presentation uses `src/runtime/palette.ts` across CPU canvases and GPU render shaders:
blue free points, yellow pins/center markers, charcoal backgrounds and neutral links. Comparison
charts use solid blue for WebGPU, dashed yellow for WebGL and dotted coral for CPU; trajectory
variants use the same three styles with their own labels. Keep diagnostic color fixtures and
spatial-grid encodings independent of the presentation palette.

## Add an experiment

Create `src/experiments/<id>/experiment.ts` and export an `ExperimentDefinition`. Vite discovers experiment manifests
through `import.meta.glob`; the demo and documentation remain lazy-loaded.
Assign the experiment ID to exactly one group in `src/app/registry.ts`, in prerequisite order.
That catalog drives both the homepage and sidebar: Foundations, Cosmos forces, Combined engine,
then Validation and optimization. The registry rejects missing, duplicate and unknown assignments.
This is a suggested reading path; the migration roadmap records research progress.

An experiment should contain:

- An interactive demo with explicit `destroy()` cleanup.
- Markdown explaining the algorithm, implementation, correctness and limitations.
- Sequences as `flow` fences, ownership as nested lists, and source-controlled SVG figures where shape matters.
- Concise Markdown findings with measurement conditions, limitations and reproduction steps.
- Backend-local shaders and resources, accessed through luma.gl APIs only.
- An entry in `src/runtime/validation.ts`; registration rejects a missing comparison contract.
  Distinguish mathematical accuracy, float32 compatibility, structure and execution equivalence.
  Do not infer complete correctness from a finite run or one numerical gate.

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

Follow `src/docs/validation-workflow.md` when investigating a mismatch. Keep historical tolerances
and failures; define any new accuracy/quality budget explicitly. Report behavior, mathematical
accuracy, legacy compatibility, layout quality and cost separately, with **Not assessed** for
missing checks or thresholds. Record existing WebGL issues as well as WebGPU issues. CPU prediction
and validation readback stay outside timed work. The matched-layout JSON schema v3 includes its
contract and separate evidence summary; older exports retain their original semantics.

Keep **Export JSON** in benchmark demos for local analysis. Routine measurement JSON and ZIP archives stay outside
Git; use the ignored `captures/` directory if you want to keep exports inside the lab folder. Small deterministic
fixtures needed to reproduce correctness bugs belong with tests, separately from benchmark captures.

## Experiments

- `precision-diagnostics`: production GLSL/native WGSL gravity versus analytic and compatibility
  references, plus controlled serial/blocked/tree sums on exact bounded-integer fixtures.
- `point-styling`: production point shaders versus WebGPU shapes, strokes and host picking,
  with exhaustive pixel checks and explicit fractional-size/zero-opacity failing controls.
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
- `point-capacity`: same-device point-count changes, GPU prefix preservation, retained-capacity/kernel reuse,
  update costs and buffer cleanup.
- `gpu-stage-profile`: frozen-input stage timing, balanced rebuilt/retained trials and exact instrumentation replay.
- `hub-springs`: pinned/unpinned degree controls and ordered cooperative neighbor prefetch, checked against the
  strict baseline on one device, evolving checkpoint validation and GPU-batched normal-frame threshold controls.
- `cell-aggregation`: cached integer memberships and bounded sorting preserve source-index sums; occupancy,
  CPU gates, duplicate-baseline controls and normal-frame GPU timing expose gains and blocked cases.

Reference pages cover the lab architecture, WebGPU vocabulary and parallel reduction.
Start with **How WebGPU works** (`#/learn`) for a guided introduction with five interactive teaching models.
These use DOM/SVG and JavaScript, require no GPU and make no performance claims.

## Interactive documentation

Keep settings, explanations, validation tables and chapter navigation visible in ordinary sections.
Use headings and section links to organize long content instead of accordions, including reports
created after running an experiment. Use the shared body typography for these section headings.
Apply the same three text roles to every experiment and document: page title, 14px reading text
(including section headings, controls and result values), and 12px secondary metadata. Distinguish
sections with spacing and medium weight rather than extra sizes, uppercase labels or heavy bold.
Use the shared wrapping tab navigation and control grid; keep wide tables within their own horizontal
scroll container, with all rows visible. These rules apply to the whole lab, including older experiments.

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
