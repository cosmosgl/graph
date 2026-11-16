# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, Markdown findings and GPU-resource
lifecycle.

Follow the **WebGPU migration** roadmap (`#/roadmap`) for Cosmos migration readiness, demonstrated capabilities,
remaining gaps and the evidence needed for a production switch.

Home opens with the current investigation and its next action, then a feature coverage map derived from
`src/docs/feature-inventory.md`. Counts describe bounded coverage, not migration completion. Feature rows
link to methods, detailed limits and retained counterexamples. The experiment catalog can group the same
studies by migration area or prerequisite reading order. The roadmap keeps the five-row task plan and
still-open milestone checklists; these are different from the reading path.

`migrationFocus` identifies one current experiment and research step. Its title, review date, conclusion
and next action come from the experiment records. The header repeats that position on every page and
marks the current navigation area. Reviewed findings remain separate from this browser's live run.

Each experiment is one complete document: question and current finding, live visualization,
expanded settings and results, technical explanations, current and earlier findings, diagnostics,
and references. A sticky contents menu sits on the right on wide screens and stays expanded after the live run, before explanations, on narrow screens. It includes article titles,
evidence states and their top-level sections. The header links to Experiments, Roadmap, Feature coverage and Learn; there is no permanent catalog sidebar.

All technical articles and investigations are embedded, with their source metadata and historical
warnings intact. Shared comparison criteria appear once. Sources move into References with their
annotations. Article headings have namespaced anchors, so repeated headings cannot collide.
Old `/run`, `/evidence` and `/docs/page?section=heading` links land on the corresponding sections.
Reading and section navigation preserve the running instance, canvas, controls and tick. Leaving
for a shared reference pauses the instance; another experiment or Home releases it. Documentation
remains readable when GPU initialization fails. All content stays expanded, without accordions.

Use the **Validation workflow** (`#/validation-workflow`) and **Numerical research**
(`#/numerical-research`) for reference roles, source-backed precision findings and acceptance policy.
Every experiment includes **What we compare**, describing its reference, gates, checked population and limits. The contract is not a live verdict.

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
blue free circles, yellow square pins/center markers, charcoal backgrounds and neutral links. Comparison
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

The current implementation uses the pinned luma `10.0.0-alpha.15` APIs throughout. Historical native-API
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

### Live experiment frame

Every live experiment uses `src/runtime/run-layout.ts`, including the standalone link diagnostic.
At 1,200px and wider, Configuration sits beside Run and its visualization/results. Smaller screens
stack the same expanded content. The top summary always names the run state, passed checks,
failures/unavailable backends and unchecked scope. It describes this browser session, not migration approval.
Rendering-only demos and benchmarks do not acquire a numerical pass merely by completing.

Author regions with `data-run-part="configuration|visualization|metrics|status|results|explanation|diagnostics"`
and actions with `data-run-action="primary|diagnostic|export"`. Primary actions drive or stop the
workload; tracing, replay, precision comparisons and sweeps remain in the visible Diagnostics section.
Collision and Combined layout also use authored `data-run-section` regions and presets.
Section links scroll without restarting or pausing a run.

Call `mountRunLayout(host, readSummary)` before asynchronous setup. Its summary getter reads the
experiment's own check records; it never interprets status text or table colors. A small observer
refreshes the getter after UI updates. Call `disposeRunLayout(host)` during destruction. Controls,
listeners and canvas objects are moved intact, preserving GPU ownership and retained-run state.

### Guidance, results and their source

Keep one short description next to a setting, using the authored control keys in
`src/runtime/run-guidance.ts`. Longer explanation belongs in an explicit `explanation` region
below the visualization, or beside its diagnostic tool. Neither grouping depends on paragraph order.
The descriptions remain visible and are connected to the controls with `aria-describedby`.

Use `src/runtime/result-format.ts` for live display values: **Pass**, **Fail**, **Unchecked** and
**Unavailable** have different meanings. A missing check is Unchecked; a missing measurement or
backend is Unavailable. Use Not applicable for a field that does not belong to that comparison.
Finite flags are Yes/No, not a correctness verdict. Use **Backend** and **Result** for equivalent
table columns; put units in headers or captions. Durations use milliseconds with three decimal
places (scientific notation below 0.001 ms), counts use comma separators, and component errors
normally use three significant digits. Deep numerical diagnostics may retain additional digits.
Memory divided by powers of 1,024 is labeled KiB/MiB. Raw exports retain original numeric values.
The shared table presenter adds header associations and a keyboard-accessible horizontal scroll
region with a visible hint when columns overflow; it never rewrites measurements or verdicts.

Live Run pages name the session start, actual reported devices and validation scope. Passes apply
only to their named checks; sweeps retain their row-specific settings. The session date is not a
measurement date for a historical article. Add explicit provenance to recorded Markdown findings:

```text
---
source: Recorded findings
recorded: 2026-11-05
device: The GPU and browser documented by the measurement
scope: The exact fixture, variant and checked population
---
```

Only these four plain-text fields are supported. Use `Not recorded` when a measurement date or
device was not retained; never infer it from a review date, seed, source revision or today's date.
The article keeps the detailed conditions and reproduction instructions. General method pages
need no measurement label. Reviewed research summaries and historical/superseded warnings retain
their separate meanings.

### Experiment navigation

`src/app/research.ts` and `research-catalog.ts` hold reviewed findings, technical article links,
and earlier investigations. Add a summary, primary method article, related articles and an
investigation list when adding an experiment. Describe its actual comparison paths: a WebGPU-only
grid or resource study must not inherit a WebGL/WebGPU/CPU trajectory claim. The registry rejects
unknown pages, missing assessments and unreachable documents. An empty investigation list means
no recorded matrix is published; local runs do not populate it.

Base routes (`#/experiment`) open the full experiment document. Old `/run` routes resolve to that
page; `/evidence` resolves to Recorded findings. Old `docs/page` URLs become `?section=doc-page`
links, retaining the original heading slug after the page prefix. Article-local links use that prefix.
Section changes scroll and focus the target without recreating or pausing the run. The contents menu
tracks the section being read. Static-document table observers have their own lifetime and are
excluded from per-tick live table refreshes.

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
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/app/learning-examples.test.ts src/app/flow.test.ts
```

## GPU regression checks

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

This runs rendering, reductions, neighborhood-force, shared-grid, weighted-link and global many-body tests in Chromium with its software WebGPU
adapter enabled. It fails if no adapter is available. The normal repository test run (`pnpm test`)
covers the engine and deck integration only. CI runs lab checks in a separate, non-blocking `gpu-lab`
job using this package's browser configuration; the core `verify` job remains required. Separate
test runs also keep the lab's luma v10 dependency cache isolated from the engine's v9 cache.
Software-adapter timings are not hardware benchmarks.

To run the native-GPU regressions using installed Google Chrome:

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

This launches Chrome without forcing a software adapter and enables the native arithmetic,
trajectory and timing regressions as well as UI tests. The separate large-graph research
runs still require an explicit `LAB_SCALE_COUNT`; they are not part of the default suite.

### Connect an existing browser (optional)

To use an existing WebGPU-capable browser instead of launching Chrome:

```sh
LAB_NATIVE_GPU=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

Keep the command running and open the printed test-session URL in the browser on the same
machine within three minutes. Tests start when the page connects; leave it open until the
terminal reports completion. This mode does not launch or configure the browser. It enables
the same native-GPU test cases, with the same opt-in research exclusions, but uses the selected
browser's GPU configuration. Record the browser, device and GPU backend when sharing results.

### Alpha.15 upgrade verification

Checked **16 November 2026**, **Apple M3**, **embedded Chromium browser**, using native-GPU mode
with a manually connected browser provider. This was a different browser environment from the
standalone Chrome command above.
The full run completed all 106 files: **517 passed, 35 failed, 21 opt-in skips**. The first GPU
failure was the retained 100k-star WebGL simulation/readback case; subsequent adapter failures
contaminated later tests. A separate stale UI assertion expected “Partial” instead of the existing
“Unchecked · incomplete batch” label; only that wording assertion was corrected.

Fresh-session reruns establish **548 distinct passing tests** across the full run and follow-ups,
not a single all-green run. **Four 100k-star WebGL simulation/readback cases remain unresolved**:
the two early-exit variants, isolated-pass readback and fence-synchronized trajectory. Observations
include context loss and an isolated first-force mismatch; some cases were blocked by an earlier
reset. The render-only WebGL 100k control and the WebGPU 100k isolated-pass control both pass separately.
Production controls and numerical/image tolerances are unchanged. The 21 large-graph research
cases were not enabled, and these regressions do not replace the recorded experiment matrices.

The production-engine suite was also run in that embedded browser: **248 passed and 11
ring-color pixel assertions failed**. Its source, luma v9 packages and their runtime dependency
chain are unchanged. This native-browser result is not a passing engine-suite claim.

To investigate a failed file, rerun its path with `test:gpu` in a fresh browser session.
Keep `src/experiments/weighted-links/measurement.test.ts` separate when diagnosing other failures:
its isolated-pass tests also use a 100k star, although their names omit the point count.

## Original comparison

`center-mass` compares two ways to calculate the global center of mass for the same 8,192 moving `float32x2` points:

- WebGL2 renders all contributions into a 1×1 `RGBA32F` framebuffer with additive blending.
- WebGPU performs a two-stage compute reduction through storage and workgroup memory.

The lab pins the coherent `10.0.0-alpha.15` family. Adapters are exported from
`@luma.gl/core/webgl` and `@luma.gl/core/webgpu`; shader utilities come from
`@luma.gl/shaders`, and `Kernel` / `RenderKernel` from `@luma.gl/graph`.
The production engine and deck integration retain their existing luma v9 dependencies.
After changing dependency versions, stop and restart the Vite dev server, then reload the page.
A running server can retain old package exports and report a missing `@luma.gl/core/webgl` specifier.
Recorded measurements retain the version used when they were collected; upgrading the lab
does not reclassify historical findings.

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
