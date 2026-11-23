# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, Markdown findings and GPU-resource
lifecycle.

The **WebGPU migration** page (`#/roadmap`) shows the current decision, next priority, and what remains before a
production switch. Each **Feature coverage** row shows the WebGL behavior, the WebGPU evidence and the remaining
checks. The links at the top jump to the coverage, parked investigations or future ideas.

**Viewer Comparison** links to the matched migration benchmark. Build the
production bundle with `pnpm run build`, then use
`pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture karate`
to replay it on the M3. The benchmark page lists large fixtures and the
declared method, and its results link to each workload.

Home features core interactive concepts by topic, with related demos linked beneath the cards.
Benchmarks, migration checks and earlier milestones appear in a separate study directory. The header links to the catalog, migration page and learning guide;
other references appear above the catalog.
Focus the search field on the right of the header to see three suggested experiments. Type to find
experiments, recorded evidence, guides and references. Quick jump shows the top four matches.
Experiment mini cards carry the same readiness badge as their related links. The × clears the query and restores the suggestions.
Use the arrow keys and Enter to open a result, or Escape to dismiss the list and keep the query.
Results jump to the relevant example or evidence on the experiment page. Agent recipes, reproduction commands, shader code,
raw captures and temporary live-run values are not indexed. Search loads its local index when you first type a query.
Coverage counts describe bounded evidence, not migration completion. Reviewed findings remain separate
from this browser's live run.

An interactive comparison can open with its title and question followed by the live preview.
A recorded study opens with its catalogue badge, question and short finding.
Diagnostics, measurements, methods and limits continue below in the same column.
When several live examples are available, the case selector changes the run and the short finding.
The topic link returns to the matching catalogue group, and the row below the content lists the other experiments in that group.
Recorded-only studies and direct evidence links can be read before a live device starts.

The catalogue badge summarizes recorded evidence for a named check. A ready-to-integrate assessment would mean the candidate is ready to begin
integration, not ready to ship. Unassessed work stays neutral; a slowdown is a warning, and a failed
check or a candidate explicitly not adopted is shown as a failure. Keep earlier unexplained failures
alongside later passing results. Case assessments live in `src/app/readiness/` and should be updated
when their linked evidence changes.

Agent recipes and agent-finding replay steps remain in their source folders and are not embedded in the app.
Old case and evidence URLs jump to the relevant section. Reading evidence keeps the active run and controls in place.
Switching live cases, experiments or Home normally releases the prior run. Opening or closing search does not interrupt
the run. Following a search result to another experiment retains the previous run in memory so returning
to it restores its state; only one previous search run is kept. A browser that cannot move an embedded viewer
without reloading it still uses the viewer's existing evidence-restoration fallback. Recorded findings remain
readable if live setup fails.

Use the **Validation workflow** (`#/validation-workflow`) and **Numerical research**
(`#/numerical-research`) for reference roles, source-backed precision findings and acceptance policy.
Each experiment explains the comparison reference and how to interpret the result below its live example.
Recorded scope and limits apply to the historical observation, not automatically to the current run.

## Run

From the repository root:

```sh
# Build both Graph packages for the side-by-side comparisons
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
pnpm --filter @cosmos.gl/gpu-lab dev
```

The **Graph interaction in WebGL and WebGPU** experiment loads the unchanged standalone production
bundle from `dist/index.min.js`; rebuild it after changing the production checkout.
The lab build includes that bundle as an asset.

Open **ForceCollision in the Cosmos packages** (`#/production-force-collision`) to step the same application against the built WebGL and WebGPU packages. The Lab compares all point positions and the RGBA pixels from both graph canvases. Choose the seven-slot case for all-pairs collision or the 4,097-slot case for hashed collision. Rebuild the corresponding package after engine changes.

Run `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-force-collision/packages.test.ts` from the repository root to replay the first eight steps in both cases.

The application uses hash routes, so experiment demos and documentation pages can be linked directly without server
rewrite configuration.

The **YouTube Network** demo uses the benchmark's prepared
[SNAP fixture](src/experiments/million-graph/production-envelope.md#workloads).
The Lab serves the prepared dataset in development and includes it in the build when present.

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
The registry validates each manifest and makes it available by route and in search. In `src/app/registry.ts`,
use a topic’s `cards` for introductory concepts and `links` for related demos or migration studies.
Unassigned experiments appear under Other studies. Update the migration page when a
finding changes a production decision or the next priority. The feature inventory supplies the checklist and its
search entries.

Add `ExperimentCase` entries and accept the selected case ID in `create` when cases use different live
views. Use these fields to introduce the case.

- `question` asks what the active case tests. Use `headerContent: 'question-only'` to lead
  directly into an interactive comparison.
- `finding` in `src/app/readiness/` gives the short answer used in the page lead and catalogue.
  Scope measured results to the workload. When the reader supplies the measurement, state what is
  already known and what the run will measure. Reserve click instructions for button labels or `tryIt`.
- `tryIt` is an optional action hint in the default **What this compares** section below the demo.
  To replace that section, supply `howItWorks.summary` as Markdown and optionally mount a figure
  with `howItWorks.figure(host)`. Set `howItWorks: false` to omit it.

Peer cards, recorded summaries and evidence links are independent of the explanation. Use
`showPeerLinks: false` or `showRecordedSummary: false` to omit the corresponding section.
All linked case evidence opens inline by default. Use `initialEvidence: 'first-recorded'` to show
only the first recorded evidence page initially when the starting case has one.

Each case also defines a description, reference, acceptance rule and links to its own method
or evidence. Set `recorded` to `null` when there is no historical result; otherwise include its observation,
date, environment, scope and limits. Include the context needed to understand each case on its own,
even when it also appears in another case. The shared group navigator makes related cases discoverable
without imposing a reading order.
A `recorded` case does not create a GPU instance. Provide an honest
`scope` to `mountRunLayout` for the current case and keep historical measurements distinct from live output.

When splitting an experiment, check each resulting page, including the original.

1. Match the title, summary, catalogue finding and displayed method heading to the question that page answers.
2. Open the demo and locate every control, chart and measurement mentioned in its summary, explanation and method.
3. Update this README’s **Experiments** list and follow incoming links to confirm that each experiment ID
   and section link still leads to the intended content.
4. Link the new page from the relevant concept in **Learn** or the corresponding migration requirement in **Feature coverage**.

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

Use a `result-chart` fence for a recorded comparison that fits in two bars. Include a plain-language
title, the metric and workload in `context`, and two `[label, value]` pairs. Keep the source table and its
scope nearby. Show phases in execution order when the sequence matters. See the rectangle
selection example in the [benchmark findings](src/experiments/viewer-comparison/benchmark-findings.md).

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

- `integrated-webgpu` runs the interactive graph and links its recorded findings.
- `integrated-webgpu-benchmarks` runs the pilot matrix, profiling controls and cooled picking replays.

- `precision-diagnostics`: production GLSL/native WGSL gravity versus analytic and compatibility
  references, plus controlled serial/blocked/tree sums on exact bounded-integer fixtures.
- `point-shapes`, `point-picking`, `point-images` and `point-rings-greyout`: separate WebGL and WebGPU
  comparisons with pixel-level evidence, including the fractional-size and zero-opacity failure cases.
- `selection` compares which points WebGL and WebGPU select when you draw a rectangle or lasso.
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
- `cluster-attraction`: production group centroids and attraction versus grouped WebGPU reduction and CPU;
  fixed native checkpoints, membership updates, GPU cost and a reproducible finding record.
- `point-attractors`: production per-point targets and strengths versus corrected WebGPU and CPU;
  independent trajectories, live target updates, disabled-stage checks and force-only GPU cost.
- `repulsion-trajectories`: independent hierarchical-repulsion trajectories, local correctness and accumulated drift.
- `combined-layout`: gravity, hierarchical repulsion, directional springs and cooling, with checkpoint validation and failure replay.
- `resident-layout`: position downloads and checkpoint agreement for CPU and GPU bounds.
- `resident-layout-edits`: position patches and link replacement in the current layout.
- `resident-frame-timing`: GPU work and CPU timing for early simulation frames with optional drawing.
- `point-capacity`: compares rebuilding GPU buffers with reusing them as points are added and removed.
  Measures update time and the buffer memory held after removal.
- `point-buffer-copy`: one manual step grows a chain from 2,048 to 8,192 points. Each preview reports the position data
  downloaded to the CPU and the total time to rebuild its buffers.
- `ribbon-generation`: stopped compute-cache investigation; retained native findings and reproduction harness, with no live benchmark controls.
- `gpu-stage-profile`: frozen-input stage timing, balanced rebuilt/retained trials and exact instrumentation replay.
- `hub-springs`: pinned/unpinned degree controls and ordered cooperative neighbor prefetch, checked against the
  strict baseline on one device, evolving checkpoint validation and GPU-batched normal-frame threshold controls.
- `cell-aggregation`: cached integer memberships and bounded sorting preserve source-index sums; occupancy,
  CPU gates, duplicate-baseline controls and normal-frame GPU timing expose gains and blocked cases.

Reference pages cover the lab architecture, WebGPU vocabulary and parallel reduction.
Start with **How WebGPU works** (`#/learn`) for a guided introduction with five interactive teaching models.
These use DOM/SVG and JavaScript, require no GPU and make no performance claims.

## Interactive documentation

Use the shared `reading-document` column and body typography to implement the
[page layout rules](AGENTS.md#layout-controls-and-navigation).
Apply the same three text roles to every experiment and document: page title, 14px reading text
(including section headings, controls and result values), and 12px secondary metadata. Distinguish
sections with spacing and medium weight rather than extra sizes, uppercase labels or heavy bold.
Use the shared wrapping tab navigation and control grid; keep wide tables within their own horizontal
scroll container, with all rows visible. These rules apply to the whole lab, including older experiments.

### Live experiment frame

The shared `src/runtime/run-layout.ts` frame stacks settings, the preview, results and diagnostics
at every width. Use `secondarySettings` to place less frequently used settings in a visible section
below the preview.

Use the preview labels to explain what differs between the two approaches. When the pictures look alike,
show each metric value once. Put both values in a shared readout or put one beside each preview.
Reserve the status line for a separate outcome such as checkpoint agreement or failure.

The run summary names the run state, checks, failures/unavailable backends and unchecked scope for
the current browser session. For a measurement without a pass budget, `showChecks: false` avoids
inventing a verdict.
Rendering-only demos and benchmarks do not acquire a numerical pass merely by completing.

Author regions with `data-run-part="configuration|visualization|metrics|status|results|explanation|diagnostics"`
and actions with `data-run-action="primary|diagnostic|export"`. Primary actions drive or stop the
workload. Tracing, replay, precision comparisons and sweeps appear in Diagnostics.
Collision and Combined layout also use authored `data-run-section` regions and presets.
Section links scroll without restarting or pausing a run.

Call `mountRunLayout(host, readSummary)` before asynchronous setup. Its summary getter reads the
experiment's own check records; it never interprets status text or table colors. A small observer
refreshes the getter after UI updates. Call `disposeRunLayout(host)` during destruction. Controls,
listeners and canvas objects are moved intact, preserving GPU ownership and retained-run state.

### Guidance, results and their source

Use `choice-control` for a labeled choice and `choice-controls` for a panel of groups.
Use the shared segmented buttons and consistent, muted group labels. A label such as
**Pixel ratio** with **1×** and **2×** is enough on its own.

For inputs and selects in the shared run layout, `src/runtime/run-guidance.ts` attaches
visible descriptions to controls with authored guidance keys using `aria-describedby`.
Use that helper when units, effects or prerequisites need explaining. Disable choices that
have no effect. For example, if a choice requires another setting, name that setting beside
the disabled choice so the reason is visible without hovering. For custom button groups,
associate the hint with the group using `aria-describedby` so screen readers can announce it.
Put longer explanations below the preview or beside the relevant diagnostic.

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
measurement date for a historical article. Reader-facing tables of committed correctness tests
show the cases and outcomes without a run date. For historical measurements, include the
measurement date in the Markdown provenance block:

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
The article keeps the measured conditions and scope. Put replay instructions in the study's
`agent-recipe.md`. General method pages need no measurement label. Reviewed research summaries
and historical/superseded warnings retain their separate meanings.

### Experiment navigation

Case records summarize named historical observations; linked findings
remain the source. `agent-recipe.md` and `agent-findings/` retain replay and source information
for research, but agent-facing instructions do not appear in the interface. A completed
investigation can be inconclusive; record presence does not establish a scientific pass.
When a browser cannot preserve an embedded viewer while moving it, returning from
a reference starts a fresh viewer. Completed viewer results are kept separately
in the current tab and included in Export JSON; graph and playback state restart.

`src/app/research.ts` and `research-catalog.ts` hold reviewed findings, technical article links,
and earlier investigations. Add a summary, primary method article, related articles and an
investigation list when adding an experiment. Describe its actual comparison paths: a WebGPU-only
grid or resource study must not inherit a WebGL/WebGPU/CPU trajectory claim. The registry rejects
unknown pages, missing assessments and unreachable documents. An empty investigation list means
no recorded matrix is published; local runs do not populate it.

Open an experiment at `#/experiment` or link directly to a section with `?section=<id>`.
Use `?section=try-<case>` to select a live case. The demo loads paused, and section changes within
a case preserve the run. Agent-recipe links lead to recorded findings. Static-document tables update
independently of live tables.

The learning guide lives in `src/docs/learn-webgpu.md`; its small interactive examples live in
`src/app/learning-examples.ts`. An `example` fence contains a registered example name, such as
`invocations` or `pingPong`. The page passes an explicit example registry to the Markdown renderer;
unregistered fences remain ordinary code blocks. Markdown HTML stays disabled.

Keep explanations in Markdown and behavior in the example module. Models use local DOM listeners,
without timers or global listeners, so removing the page releases them. Add explicit lifecycle cleanup
before introducing animations, observers or GPU resources. Chapter links support direct opening
(`#/learn/8`); in-page chapter jumps preserve example state.

## WebGPU migration checks

The suite exercises the [first migration slice](src/docs/validation-workflow.md).
It checks the candidate's solver and topology, circle and solid-link rendering,
picking and navigation, data replacement, and GPU resource lifetimes. Run it on
the local machine and record the actual Chrome version and adapter.

Build the WebGL control and WebGPU candidate before running the suite from the repository root. The Lab's **Run the same Graph application** page loads these two standalone packages in separate frames.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
pnpm --filter @cosmos.gl/gpu-lab test:gpu
node --test experiments/cosmos-gpu-lab/scripts/migration-results.test.mjs
```

Pass a test path to focus the run, for example
`src/experiments/integrated-webgpu/runtime.test.ts` for the small integrated graph
and its picking and rendering checks. Moving-style and large-graph checks use
the opt-in flags and visible-browser settings in their recipes.

Use [the matched benchmark](src/experiments/viewer-comparison/benchmark-method.md)
to assess responsiveness against production WebGL. It compares the same graph
workflows and applies the declared workload margins. The Node tests above check
when the benchmark has enough evidence to issue a timing verdict.

### Connect an existing browser

To run in the browser already open on your machine:

```sh
LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/runtime.test.ts
```

Keep the command running and open the printed test-session URL within three
minutes. Tests start when the page connects; leave it open until the terminal
reports completion. This mode does not launch or configure another browser.
Record the actual adapter: the browser controls which GPU it uses.

### Optional application and tooling checks

Use the relevant local checks when changing the shell, documentation or tooling:

```sh
pnpm --filter @cosmos.gl/gpu-lab lint
pnpm --filter @cosmos.gl/gpu-lab typecheck
pnpm --filter @cosmos.gl/gpu-lab build
```

### Historical replays

To repeat a recorded study, use its source revision or archived source snapshot
with the dependencies and commands documented for that run. The broader set of
Lab UI, tooling and experimental tests is available at commit `08e5ff5d`.
Use the study's own snapshot for exact reproduction when one is available.

Benchmark JSON is written under ignored `captures/<run>/`, with `local` as the
default. Measurements are observations, never golden snapshots, and require no
`-u`. Keep exports local; commit concise findings, scope and reproduction steps.
Set `LAB_ARTIFACT_RUN` to a unique directory name for a new test-produced capture;
the same artifact name in the same directory is replaced on the next run.
The normal repository `pnpm test` still covers the production engine and deck
integration with its existing browser configuration.

### Recording reproducible source

For timed benchmarks and failure investigations, a clean commit SHA identifies the source.
For an uncommitted run, retain an exact snapshot and record its location and SHA-256.
Record the revision and working-tree state before and after the run. If they change during
the run, report it as provisional.
For a modified tree, the following commands save the tracked changes and list
new files in the existing unique capture directory. Set `lab_run_id` to that
directory's name before running them:

```sh
lab_capture="experiments/cosmos-gpu-lab/captures/$lab_run_id"
mkdir -p "$lab_capture"
git rev-parse HEAD > "$lab_capture/source-revision.txt"
git status --short > "$lab_capture/source-status.txt"
git diff --binary HEAD > "$lab_capture/source.patch"
git ls-files --others --exclude-standard > "$lab_capture/untracked-files.txt"
```

The patch includes staged and unstaged tracked contents; the list does not contain
the new files themselves. Copy every new source or input needed by the run into
the capture, preserving its repository-relative path. Record any required ignored
inputs too. After the run, check that the patch and copied files still match the
working tree; a status list can stay the same when file contents change. To
reproduce, start from the recorded revision in a separate checkout,
apply the patch, restore those files, install the recorded dependencies and rebuild
generated controls before running. If the exact source cannot be retained, label
the result provisional rather than claiming it can be recreated.

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

In that historical checkout, rerun a failed file with `test:gpu` in a fresh
browser session. Run `src/experiments/weighted-links/measurement.test.ts`
separately because its isolated-pass tests also use a 100k star.

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
