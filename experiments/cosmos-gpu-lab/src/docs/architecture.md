See [WebGPU migration](#/roadmap) for current priorities, production requirements and feature coverage.

The lab is a **modular research app**: one shared interface hosts independent GPU experiments,
their explanations and their results. It lives in the private workspace package
`experiments/cosmos-gpu-lab`, with Vite, TypeScript and plain DOM UI code.

- App shell — navigation and routes
  - Experiment registry
    - Experiment demo — controls and coordination
      - WebGL backend + GLSL
      - WebGPU backend + WGSL
    - Documentation and reports
      - Shared vocabulary and concept guides

## 1. The shell manages navigation and lifecycle

The shell handles navigation, loading states and errors. Hash routes open experiments,
their sections, and reference pages.

```text
#/architecture
#/point-rendering
#/center-mass?section=case-comparison
#/vocabulary/invocation
#/concepts/reduction
```

Section links within an experiment keep its live view in place. Opening a separate guide or reference
pauses playback and sweeps at a safe boundary and detaches the view. Returning reattaches the same
controls, canvases, positions, tick, reports and settings. Playback resumes from its Run or Play control.
An operation already in flight may finish its current step.
Incomplete timing batches remain unaccepted and can be restarted.

Opening another experiment or the homepage destroys the retained run. There is no cache of live
GPU sessions. `src/runtime/retained-run.ts` handles setup races: documentation can open while the
same run initializes, while a retired run that finishes late is destroyed instead of replacing
the newer one. A browser reload still starts fresh; this is in-session navigation, not persistence.
New destinations start at the top, returning pages restore their reading position, and explicit
section links take precedence. Retiring a run also retires its saved scroll position.

The shell lives in `src/app/app-shell.ts`; route parsing lives in `src/app/router.ts`.

The reading-path view uses a curated catalog in `src/app/registry.ts`:

| Group | Reading path |
| --- | --- |
| Foundations | Reductions, spatial indexing and basic point rendering |
| Cosmos forces | Local neighbors, exact and hierarchical repulsion, springs and collision constraints |
| Combined engine | Independent trajectories, composed forces, resident frames and matched layouts |
| Validation and optimization | Production gates, timing, targeted optimizations and resource capacity |

Experiments within each group follow a suggested prerequisite order. They have no sequence numbers;
the [migration page](#/roadmap) describes research progress and remaining work.

The [validation workflow](#/validation-workflow) defines comparison and reporting rules; the
[numerical research report](#/numerical-research) records their specification basis. `defineExperiment`
adds a **Validation contract** page from `src/runtime/validation.ts` and rejects missing entries.
Contracts describe existing acceptance and coverage, not a global pass. The matched-layout live
summary and schema v3 export separate limited behavior checks, legacy compatibility and quality;
other experiments retain their detailed reports with the contract explaining their scope.

### Shared research navigation

Every experiment is a complete document assembled by `src/app/experiment-page.ts`. The live view,
technical articles, current findings, earlier investigations, diagnostics and references remain
expanded on that document. A sticky right-hand contents menu tracks the section being read; on
narrow screens it stays expanded after the live run and before the explanations. Simple header links replace the
permanent left catalog sidebar. The full grouped catalog remains on Home.

Articles reuse their Markdown, assets, source metadata and investigation warnings. Shared comparison
criteria appear once. Reference sections keep their annotations while moving to the document footer.
Article headings have page-prefixed IDs, including the old duplicate-heading suffixes. Old `/docs/page`
URLs and heading links resolve to these anchors; `/run` and `/evidence` also remain valid aliases.
Section navigation updates the location and focus without pausing or remounting the run, including
browser Back and Forward. The document remains readable after a GPU initialization failure.

The registry checks that every article is included and replacement links resolve. Experiments
without a published matrix say so explicitly; a local run never becomes a recorded finding.

`src/app/research.ts` and `research-catalog.ts` hold reviewed summaries and document assignments.
The [migration page](#/roadmap) reads its current focus from the experiment's research record. Its
coverage groups, counts and search entries share the rows in `src/docs/feature-inventory.md`.
The coverage list and notes are visible on load. Old feature-inventory URLs focus the matching row or
section. Detailed measurements remain in the linked experiments.

Long Markdown pages gain duplicate-safe heading IDs, route-preserving section links and a contents
rail, with a visible short contents list above the article on smaller screens. The learning guide and
vocabulary retain their own navigation. Live experiments share expanded configuration, visualization,
results and diagnostics regions. The visualization comes first on
narrow screens. Wide screens place the two beside
each other. A session summary reports actual checks, failures and unchecked scope. Arithmetic, cooling and validation settings stay in Configuration;
primary actions stay with the visualization, while isolation, replay, precision and timing actions stay
in Diagnostics. The summary reads typed experiment records rather than parsing displayed text.
Rendering-only and benchmark completion never imply numerical acceptance. Section jumps scroll without pausing or rebuilding
the run. How it works shows reference, acceptance, population and limits as ordinary content. The live variant is always named, and recorded conclusions remain separate
from the browser’s current run.

Static-document tables have separate observers, disposed with the retained experiment. Per-tick
refreshes exclude these tables. The run frame connects short setting descriptions to controls, presents tables with
shared numeric and verdict conventions, and names the live session's devices and validation scope.
Long explanations remain visible below the visualization or alongside the diagnostic they explain.
Recorded measurement articles carry explicit source, measurement date, device/browser and scope
metadata in Markdown. Missing historical metadata stays marked as not recorded; the review date
does not become a measurement date. Table scrolling and source labels change presentation only,
not the numerical gates or exported raw measurements.

The catalog can group the same experiments by migration area or reading path. Current investigation, bounded study, foundation and parked describe purpose, not approval. A parked sub-investigation does not park its whole experiment. Explicit method verdicts name retained controls or rejected alternatives only where the evidence has been reviewed; archive states alone never imply viability.

The experiment contents tree includes article titles, evidence states and source-level section headings. On wide screens it stays beside the article; on narrow screens it stays expanded after the live run and before explanations, so the graph remains near the top. Sticky-header height is measured for section offsets. Links preserve the live canvas and settings.

This structure addresses run retention, status/entry-point and history-priority problems across the catalog. Each comparison description names its actual backends and reference roles; a
WebGPU-only study does not inherit an independent WebGL/WebGPU/CPU trajectory description.
Full-text search and further reader-usability checks remain follow-up work.

The design follows [Diátaxis’s incremental approach](https://diataxis.fr/how-to-use-diataxis/),
[clear section labels and contents alternatives](https://design-system.service.gov.uk/components/tabs/),
[retaining superseded decisions with explicit status](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
These sources guide the design; they do not establish that this exact single-document layout is
optimal for every experiment. Browser task checks validate navigation behavior, not reader usability.

## 2. Each experiment is a self-contained module

An experiment typically has this structure; the exact backend organization varies:

```text
src/experiments/<experiment>/
  experiment.ts       Registration and documentation pages
  view.ts             Controls, canvases, execution, displayed results
  backend.ts          GPU implementation or shared backend contract
  reference.ts        CPU reference, when needed
  shaders/            WGSL or GLSL
  docs/               Technical explanations, findings and reproduction steps
```

WebGL/WebGPU comparisons can have separate `webgl/` and `webgpu/` directories with their own
backend implementations and shader files. Vite imports shader files as strings using `?raw`.

The common contract in `src/runtime/experiment.ts` is intentionally small:

```typescript
type ExperimentDefinition = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  create: (host: HTMLElement) => Promise<ExperimentInstance>;
  pages: ExperimentPage[];
}

type ExperimentInstance = {
  pause?: () => void;
  destroy: () => void;
}
```

Vite automatically discovers `src/experiments/*/experiment.ts` through `import.meta.glob`.
Lightweight manifests load at startup; demo implementations and experiment documentation load
on demand. The registry checks for duplicate experiment and page identifiers, requires
each experiment to have documentation, and checks that every experiment belongs to exactly one catalog group.

## 3. Experiments coordinate comparisons; backends own GPU work

The original [center-mass experiment](#/center-mass) generates one shared point state and sends
the same positions to both backends each tick. A CPU reference provides a correctness baseline.

```flow
Shared positions for tick N
WebGL · Blend into a 1 × 1 texture | WebGPU · Reduce through partial buffers | CPU · Reference center
Compare centers · Display errors and timings
```

The view owns the controls and comparison logic. Each backend owns its buffers, pipelines,
shaders and device resources. Backend interfaces are specific to the experiment; the shell
does not impose one universal rendering or simulation API.

### Where luma.gl fits

All experiment GPU work goes through the pinned luma `10.0.0-alpha.15` family:

- `Model` and `UniformStore` implement WebGL shaders, attributes and uniforms.
- `Kernel` and `RenderKernel` implement WebGPU compute and drawing with explicit binding layouts.
- luma buffers, textures, framebuffers and canvas contexts own resources; passes and command encoders schedule work.
- luma readback methods, fences and `QuerySet` provide validation, completion and timestamps.

The boundary includes diagnostics and browser tests: no underlying device handles, native GPU objects
or native command calls. Small shared helpers in `src/gpu/` remove repeated setup; shader algorithms
and experiment-specific ownership stay local. `typecheck` also checks this boundary. CPU heatmaps and
image assertions may use Canvas 2D.

This tests luma integration for the isolated experiments. `GPUCommandGraph`, host-owned devices,
complete-engine lifecycle and production migration remain separate work. Historical performance
captures predate this API migration and should not be pooled with new measurements.

## 4. Each experiment answers a migration question

| Experiment | What it investigates |
| --- | --- |
| [Global center of mass](#/center-mass) | Tick-by-tick correctness of WebGL blending versus WebGPU reduction |
| [Scalable reduction](#/scalable-reduction) | Millions of GPU-resident points, hierarchical reduction and optional readback |
| [Point rendering](#/point-rendering) | WebGL point sprites versus WebGPU instanced quads for circles |
| [Performance lab](#/performance-lab) | Controlled rendering and center-mass benchmarks using existing implementations |
| [Spatial grid](#/spatial-grid) | Count → prefix scan → scatter, producing cell ranges and grouped point indices |
| [Neighborhood forces](#/neighborhood-forces) | Grid-based local repulsion versus tiled all-pairs, integration and GPU-resident circle rendering |

Scalable reduction initializes and moves positions on the GPU, and rendering reads the same
storage buffer. This lets us study an architecture for larger simulations without uploading
every point from JavaScript on every tick. Its center marker reads the reduction result
directly, so it remains visible with CPU readback disabled.

The spatial-grid experiment builds a neighborhood index. Neighborhood forces reuses that builder
with borrowed position buffers and a shared device, then consumes its cell ranges and point indices
to calculate local repulsion. It does not yet implement the global many-body force.

## 5. Documentation is part of each experiment

Markdown pages sit beside the implementation and SVG diagrams. Results pages summarize findings,
measurement conditions, limitations and reproduction steps.
The shared renderer provides:

- GLSL and WGSL syntax highlighting.
- Plain-text flow fences for sequences and fork/join comparisons; SVG figures where geometry matters.
- Links and quick vocabulary previews.
- Shared concept explanations, such as [parallel reduction](#/concepts/reduction).

Markdown is rendered with raw HTML disabled. Flow labels are escaped text in semantic lists, so
quick vocabulary definitions work inside the steps. Source-controlled SVG figures are loaded as
images, with alternative text describing their meaning.

Commit concise Markdown findings with the environment, workload, implementation variant,
methodology and a small results table. Machine-specific numbers are observations, not portable
performance expectations. Performance Lab and Neighborhood forces export raw measurements and
summaries as JSON for local analysis. Keep those captures outside Git; `captures/` in the lab is
ignored for this purpose. Preserve small regression fixtures only when needed to reproduce a bug.

## 6. Correctness and performance have separate workflows

Interactive demos make behavior inspectable through shared inputs, CPU references and
experiment-specific validation. Benchmarks use warm-ups, repeated batches, matched inputs
and p50/p95 summaries, with setup outside the sampled work.

We distinguish **CPU submission time** from **time until GPU completion**. These are
browser-level measurements. Neighborhood forces additionally measures GPU pass intervals with
optional timestamp queries, keeping those results separate from wall time. Its repeatable sweep
varies count, density, radius and cell size. The WebGL completion measurement in Performance Lab includes an amortized pixel readback, while
WebGPU waits for queue completion. See the [benchmark methodology](#/performance-lab?section=doc-methodology)
for the precise boundaries and comparison limits.

The current “simulation” benchmark measures center-mass reduction, not the entire Cosmos
force simulation. Interactive validation and documented findings also do not imply that every GPU
algorithm is covered by an automated regression test. Browser tests cover flow-label escaping and keyboard-accessible vocabulary previews as part
of the repository's Vitest suite. Neighborhood forces
adds CPU and WebGPU regression cases, including borrowed grid buffers; its dedicated `test:gpu`
command requires a WebGPU adapter.

## 7. Adding an experiment and evolving the architecture

1. Create `src/experiments/<id>/experiment.ts` and export a definition using `defineExperiment`.
2. Keep the manifest lightweight: dynamically import the demo from `create(host)`.
3. Implement the demo and backend ownership, including explicit `destroy()` cleanup.
4. Add documentation explaining the algorithm, correctness, performance and limitations.
5. Add CPU references and validation, then document findings and reproduction steps in Markdown.
6. Place the experiment ID in its prerequisite position in one catalog group in `src/app/registry.ts`.

Vite discovers the manifest automatically; the catalog supplies its group and display order.
The shell creates the homepage entry and complete experiment document from that information.

Most GPU ownership and scheduling remain local to each experiment. As several experiments
begin sharing the same operations, we can extract proven primitives—reduction, scan, grid
construction and rendering—into reusable modules. This is a direction for future work;
the lab does not yet have a shared GPU scheduler or a complete force-simulation engine.

## Run the lab

From the repository root:

```sh
pnpm install
pnpm --filter @cosmos.gl/gpu-lab dev
```

Open the local URL printed by Vite and choose **Reference → Lab architecture** to return here.
