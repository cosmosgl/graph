# Cosmos GPU Lab

A Vite application for focused, documented experiments supporting the Cosmos WebGL-to-WebGPU migration. Each
experiment owns its demo, shaders, technical documentation, diagrams, Markdown findings and GPU-resource
lifecycle.

The **WebGPU migration** page (`#/roadmap`) shows the current decision, next priority, and what remains before a
production switch. Each **Feature coverage** row shows the WebGL behavior, the WebGPU evidence and the remaining
checks. The links at the top jump to the coverage, parked investigations or future ideas.

For contributors porting an engine module, the audit maps its WebGL and WebGPU owners and records the differences found through the public API. [Engine architecture audit](../graph-webgpu/architecture-audit.md)

**Viewer Comparison** retains the matched prototype benchmark. Build the WebGL
bundle with `pnpm run build`, then use
`pnpm --filter @cosmos.gl/gpu-lab benchmark:migration --fixture karate`
to replay it on M3. The packaged force benchmark loads both built Graph packages.

Home features core interactive concepts by topic, with related demos linked beneath the cards.
Benchmarks, migration checks and earlier milestones appear in a separate study directory. The header links to the catalog and migration page.
Other references appear above the catalog.
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

Open **Points in the Cosmos packages** (`#/production-points`) to compare all eight shapes at pixel ratios 1 and 2. Choose a diameter and a center placement. The two CSS offsets are (0.25, 0.375) and (0.1, 0.4). The rounding-tie placement tests 32 centers halfway between 1/16-device-pixel grid lines. Its **24 / 22 control** replays the integer diameters from the original SwiftShader comparison. The table counts differing RGBA pixels per shape and row, and the overlay shows their locations.

Replay the Points fixtures on the native GPU or Chromium's SwiftShader software adapter. Each run checks 24 combinations of placement, fractional diameter and pixel ratio, plus the 24 / 22 tie control at each ratio. A difference of one level in any RGBA channel anywhere in the frame fails the test. The tests also check the expected shape silhouettes and write per-shape counts for every preset.

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-points/packages.test.ts
LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-points/packages.test.ts
```

Open **Lines in the Cosmos packages** (`#/production-lines`) to compare four links, their crossing and a point painted over a link. Choose a style, move an endpoint and switch between pixel ratios 1 and 2. Each run reports exact RGBA differences and the object that each package selected at the same pointer coordinates.

Open the endpoint motion case (`#/production-lines?section=try-endpoint-motion`) to scrub two dashed or solid links through a pixel boundary. At 1×, move the phase to −1 device pixel and enable the difference overlay to inspect the worst recorded native dashed frame.

Open **Forces in the Cosmos packages** (`#/production-forces`) to step both packages and read back their positions. The combined case (`#/production-forces?section=try-combined`) runs weighted springs, repulsion and collision together. Run to tick 8 and click the gold link halfway between the orange point and its lower neighbor. Its former midpoint now returns a background click. The hierarchical repulsion case uses 8,192 slots and follows the spread and settling of the layout through tick 32.

Open **Dense communities** (`#/production-forces?section=try-dense`) or **Hub** (`#/production-forces?section=try-hubs`) to compare all three forces at 8,192 slots. Step once and click the gold link or its lilac endpoint. Select tick 100 to inspect the settled layout. The two cases share their public application code with the native frame and picking benchmark. [Replay instructions](src/experiments/production-forces/agent-recipe.md)

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-lines/packages.test.ts src/experiments/production-forces/packages.test.ts
LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-lines/packages.test.ts src/experiments/production-forces/packages.test.ts
```

With both development Storybooks running on ports 6006 and 6007, run `node scripts/check-storybook-links.mjs` to replay **Link Hovering** and **Link Style Playground** on each engine.

The application uses hash routes, so experiment demos and documentation pages can be linked directly without server
rewrite configuration.

The **YouTube Network** demo uses the benchmark's prepared
[SNAP fixture](src/experiments/million-graph/production-envelope.md#workloads).
The Lab serves the prepared dataset in development and includes it in the build when present.

Open **Moving YouTube selection and labels** (`#/production-graph-api?section=doc-youtube-selection`) for the real-package M3 replay at 65,536 and one million points. The driver repeats four native drags and measures both readbacks, the highlight setter and the Storybook label redraw. [Replay instructions](src/experiments/production-graph-api/agent-recipe.md)

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
4. Link the new page from the corresponding migration requirement in **Feature coverage**.

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
- `performance-lab`: optional diagnostics for isolated rendering and reduction costs.
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
- `ribbon-generation` and `layout-acceptance`: recorded compute-ribbon and prototype layout studies with replay instructions pinned to their historical source.
- `gpu-stage-profile`: frozen-input stage timing, balanced rebuilt/retained trials and exact instrumentation replay.
- `hub-springs`: pinned/unpinned degree controls and ordered cooperative neighbor prefetch, checked against the
  strict baseline on one device, evolving checkpoint validation and GPU-batched normal-frame threshold controls.
- `cell-aggregation`: cached integer memberships and bounded sorting preserve source-index sums; occupancy,
  CPU gates, duplicate-baseline controls and normal-frame GPU timing expose gains and blocked cases.

Reference pages cover the lab architecture, WebGPU vocabulary and parallel reduction.

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

An `example` fence embeds a view registered by the page, such as the feature coverage table on
the migration roadmap. Unregistered fences render as ordinary code blocks.

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

Use [the packaged force benchmark](src/experiments/production-forces/scale-timing.md)
to compare the built packages on the same graph workloads. The
[prototype benchmark](src/experiments/viewer-comparison/benchmark-method.md)
retains its larger fixtures and workload margins. The Node tests above check
when the timing comparator has enough evidence to issue a verdict.

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

### Rehearse the production cutover

Today the ordinary Graph and Deck prepublish hooks rebuild WebGL. The
qualification script stages WebGPU under both public names with
`private: true` and installs those archives into a clean app. Keep the
candidate private through hardware qualification and release review.
[Production Graph build](../../vite.config.ts) · [Deck manifest](../../integrations/deck-layers/package.json) · [Packed app](../../scripts/prepare-packed-webgpu-deck.sh)

1. Once the cutover is accepted, make the ordinary public builds emit Graph's
   ES module, standalone `dist/index.min.js` and declarations, and Deck's
   WebGPU device and position-buffer host. Give both public manifests the
   same new release version. Carry over the qualified runtime and declaration
   dependencies, including Deck 10.0.0-alpha.1, luma 10.0.0-alpha.14 and
   math.gl 5.0.0-beta.8. Verify the consumer resolves a single luma core.
   [Graph packager](../graph-webgpu/pack-public.mjs) · [Deck packager](../../integrations/deck-layers/pack-public.mjs) · [Lockstep check](../../scripts/check-lockstep.mjs)
2. Run CI against the promoted sources. Build Pages with its ordinary command,
   open the default Storybook and verify that Quick Start and a Deck story
   draw and pick on WebGPU. Point the Lab's WebGL pane at the frozen UMD
   below and verify the hashes of the two files it actually loads.
   [CI](../../.github/workflows/ci.yml) · [Pages build](../../.github/workflows/github_pages.yml) · [Storybook aliases](../../.storybook/main.ts) · [Lab loader](src/experiments/viewer-comparison/production-bundle.ts)
3. Pack the two public manifests from a clean release revision. Install those
   exact tarballs outside the workspace and record their SHA-256s. Typecheck
   the consumer and shared stories, run the standalone script, then repeat
   drawing, picking, resize, teardown and recovery under both Deck owners.
   Use that verified pair for publication. Record the preceding public
   versions and Pages deployment revision. To roll back, pin applications to
   the preceding Graph and Deck pair with its compatible peers, and redeploy
   the preceding site revision.
   [Consumer checks](../../scripts/check-packed-webgpu-deck.mjs) · [Recorded qualification](src/experiments/integrated-webgpu/host-ownership.md#recovery-with-the-signed-picking-and-camera-changes)

#### Disposable public-package rehearsal

A disposable copy of `cfaae9f7` built both public packages as
`4.0.0-rehearsal.0` through their ordinary prepublish and pack commands on
Node 22.23.5 and 24.2.0. All three Graph and all six Deck distribution files,
including declarations, matched the qualified `12c2b599` packages byte for
byte. The working branch still builds WebGL by default.

The default Pages build indexed 46 stories. On SwiftShader, Quick Start picked
point 2, the Deck Graph Layer drew and picked, and the website home drew 48,000
points. The Lab loaded the frozen WebGL and promoted WebGPU files and both
selected point 1 after it moved. The initial root typecheck reported 201
errors in 15 historical WebGL test files, and its Vitest configuration missed
all 13 WebGPU suites. The local capture keeps package reproduction, CI test
porting and strict consumer checks separately under
`captures/public-promotion-cfaae9f7-20261126/` in `REHEARSAL.md`,
`ci-routing/` and `consumer/`.

#### TypeScript consumers and the default CI suite

A clean app installed both rehearsal tarballs with `npm install --strict-peer-deps`.
TypeScript 5.9.3 accepted the published API with the fixture's `strict: true`
and `skipLibCheck: true`. The production build succeeded, the npm runtime
audit found zero advisories, and the classic script at `dist/index.min.js`
exposed `Cosmos.Graph` without a module loader.
[Consumer source](../graph-webgpu/fixtures/deck-consumer/main.ts) · [Compiler settings](../graph-webgpu/fixtures/deck-consumer/tsconfig.json)

Apps that also check dependency declarations have different results depending
on their imports. With ES2022 and DOM libraries, the same Graph-only example
passed on TypeScript 6.0.3. On 5.9.3, math.gl 5.0.0-beta.8 references
`es2025.float16`, a library that compiler cannot supply. The full Deck app
also imports the luma WebGPU adapter. On TypeScript 6 its declarations
require `GPUCanvasConfigurationOut`, which the bundled DOM declarations
do not define. Adding all of `@webgpu/types` creates conflicting globals.
On TypeScript 5.9, adding those GPU declarations still leaves three float16
references in math.gl and loaders.gl. The frozen WebGL 3.6.1 Graph-only
control passed both full checks after the app installed its two missing D3
type packages. Qualify the dependency family against these imports before
promising full declaration checking for Deck.

The external consumer from `78f957f7` also passed strict application checks
on TypeScript 7.0.2. With dependency checks enabled, the Graph-only app passed
on 6.0.3 and 7.0.2. The full two-owner app failed on both at the same luma
`GPUCanvasConfigurationOut` declaration. The three compiler versions, two
apps and both settings are recorded under
`captures/signed-graph-deck-78f957f7-jo49x0fh/strict-consumers/`.

The same packed Graph and Deck app passed **full dependency checking** on
TypeScript 6.0.3 and 7.0.2 with the following browser declarations. Each run
installed the tarballs using `npm ci --strict-peer-deps`, checked the real
Deck WebGPU adapter import and built the app. To reproduce the check in the
prepared consumer, install these development dependencies and extend its
existing `tsconfig.json`.

```sh
npm install --save-dev --save-exact --strict-peer-deps typescript@6.0.3 @types/web@0.0.250 @webgpu/types@0.1.74 @types/node@22.20.7
```

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@types/web", "@webgpu/types"],
    "skipLibCheck": false
  }
}
```

Save this as `tsconfig.dependencies.json` and run
`npx tsc -p tsconfig.dependencies.json`. These DOM declarations provide
the browser APIs and leave the GPU declarations to the WebGPU Working Group
package. The Node 22 declarations also agree with this DOM version on
`URLPattern`. TypeScript 5.9.3 still reports missing float16 types in math.gl
and loaders.gl with this profile. Its ordinary strict app build passes.
The compiler outputs, lockfiles and package digests are in
`captures/full-types-m63miukc/`.

In the scratch checkout, the ordinary typecheck covered the WebGPU source,
shared stories, integration and website. The default browser job selected
all 13 candidate test files and a public Deck test file on Chromium's
SwiftShader adapter. All 60 tests passed, including 58 candidate checks and
one case for each Deck graph owner. Both owners picked a point and
link at two canvas sizes. Removing the layer destroyed its own graph, left
the supplied graph editable and left the shared device usable. The reference
job uses the original 15 test files at `fad6e487`. Its recorded run had
285 passes and one opt-in skip. Two SwiftShader runs with the signed
`951ec4d7` packages confirmed that two Deck layers sharing one Graph advanced
it once per distinct timeline tick. After Deck finalized the first layer,
its pick returned `null` and the survivor kept stepping and picking point 0.
Both results and the replay are in
`captures/signed-graph-deck-951ec4d7-bi347zmj/shared-timeline/`.
The original capture contains a file-by-file coverage map,
the reproducible CI patch and the original failures under
`captures/public-promotion-cfaae9f7-20261126/ci-routing/`, with the external
TypeScript results in its sibling `consumer/` directory.
[Reference Deck contracts](../../test/deck-layers.test.ts) · [Candidate host contracts](../graph-webgpu/test/host.test.ts) · [CI workflow](../../.github/workflows/ci.yml)

The branch's WebGPU CI job installs bundled Chromium and runs the candidate
suite with `COSMOS_TEST_SWIFTSHADER=1`. It then builds and installs both
tarballs into a clean TypeScript app. The packed check covers the standalone
script, four ownership and display-density combinations, a shared timeline,
two viewport drags and two stale bounds completions. In the quarter-scale
thumbnail, Deck 10 originally reported the press coordinates throughout a
drag. The same gesture on the corrected package moved point 0 to its new
location and a fresh pick at the old position missed. The geometry suite runs
unchanged against both engines. The public config tests exercise callbacks
that replace data or destroy the graph during initialization.
[Packed app contracts](../graph-webgpu/fixtures/deck-consumer/contracts.ts) · [Shared geometry cases](../../test/public-geometry.ts) · [Config and pending edits](../graph-webgpu/test/config-change-pending-data.test.ts)

The disposable public cutover at `c418e90a` reproduced all nine candidate
distribution files with the ordinary prepublish hooks. Include the existing
candidate development dependency `@types/node@26.6.6` when moving its build
to the public root. Otherwise the declaration generator picks a different
local name for luma's Buffer import. The regular Pages build drew the
48,000-point homepage and picked point 2 in Quick Start. The Deck layer
drew, hovered and tore down. The compiled Lab loaded the two expected
distributions and picked point 1 after the same gravity step in each.
The replay patch and file digests are in
`captures/public-promotion-c418e90a-20261126/`.

The packed website at `c418e90a` drew all 1,890,815 points and 2,315,222
links from the California–Nevada DIMACS fixture (SHA-256 `c6039f43`) on
M3 with a 128 MiB device binding limit. It also drew ten million points
in one call with the 160,000,000-byte grant. The stock site and the
headless simulation checked IDs and coordinates near the end of the
buffer. The previous build reproduced the Roads picture only with a
raised 256 MiB grant. The current examples and component checks are
documented with their fixtures, click IDs and pixel comparisons.
[Full website replay](../../website/README.md#packed-graph-qualification) · [Headless capacity tests](../graph-webgpu/test/simulation-capacity.test.ts)

#### Linux release rehearsal

On Debian 12 arm64, Node 22.23.5 passed the frozen strict-peer install,
lockstep, lint, typecheck, public builds, pack commands and Pages build.
All nine Graph and Deck distribution files matched the signed `951ec4d7`
packages byte for byte. The production dependency audit reported zero
known vulnerabilities.

Chromium 151 read a GPU buffer on Linux, then lost the device on its first
canvas clear. Both SwiftShader runs initially passed 39 of 63 tests. Adding
`--enable-features=Vulkan` and `--use-vulkan=swiftshader` made a red texel
visible in the browser screenshot. All 63 tests then passed on native Debian
arm64 and on Ubuntu 26.04 amd64 under emulation. The local capture includes
the Linux-only launch patch, both sets of logs and the plain WebGPU control
in `captures/linux-public-promotion-951ec4d7-20261126/`.

On a local Ubuntu 26.04 x86_64 container under emulation, the job for
`c418e90a` passed all 95 source cases and ten packed Graph and Deck cases
using Node 22.23.5 and Chromium 151 SwiftShader. The Linux and macOS
packages contained identical distribution files. The Graph archive differed
only in the OS byte of its gzip header. The stage logs and file comparisons
are in `captures/private-webgpu-ci-c418e90a-ubuntu-amd64-20261126/`.

GitHub's hosted Ubuntu runner passed both CI jobs at `592fd779`. It ran
293 WebGL and Deck tests, 95 WebGPU tests and ten packed-app checks.
SwiftShader covered the software adapter. Qualification on a second
physical GPU family remains open.
[Hosted CI](https://github.com/cosmosgl/graph/actions/runs/45872530472)

The candidate CI suite at `2b2c17a4` ran on a clean Linux source archive.
On the first cold software run, the label, click, hover and camera tests
finished their observation windows before the GPU had supplied the result.
The tests now poll the actual value with a longer allowance on SwiftShader.
All 84 source cases and all ten packed browser checks passed on Debian arm64
with Node 22.23.5 and Chromium 151.0.7922.34. The full logs are under
`captures/private-webgpu-ci-78f957f7-20261126/final/`. On macOS the reference job's
single-worker schedule passed 293 WebGL and Deck cases with one opt-in skip.
A parallel run during qualification had three failures, including two WebGL
area queries that returned `null`. The package pair also passed a fresh
offline `npm ci --strict-peer-deps` and production app build with npm lifecycle
scripts enabled. The macOS and Linux Graph tarballs contain identical files
and tar metadata. Only the OS byte in their gzip headers differs. The two Deck
archives match byte for byte.

### Historical replays

At promotion, record the full Git revision of the last WebGL source, its frozen
lockfile and the SHA-256 of the standalone file used for qualification. Build
the reference in a separate directory so the new production build can use the
normal `dist/` path. This rehearsal reproduced the WebGL file used by the two
packaged engines on M3.

```sh
webgl_ref=fad6e487a23ce1f4d94b7d05add2bab18eeac559
webgl_build=$(mktemp -d)
git archive "$webgl_ref" | tar -x -C "$webgl_build"
pnpm --dir "$webgl_build" install --frozen-lockfile --ignore-scripts
pnpm --dir "$webgl_build" exec vite build --mode umd
shasum -a 256 "$webgl_build/dist/index.min.js"
# 74a216a70550c0a990b2e113e7638086ec4099ef172e0704dc5b3d7692c8813e
```

For a fixed-tick timing replay, place that file under `captures/<run>/webgl.js`
and the qualified Graph tarball's `dist/index.min.js` under
`captures/<run>/webgpu.js`. The packaged force benchmark's `--matched-ticks
--bundles <run>` options load those exact bytes and save both hashes. The
development Lab continues to use the workspace build by default.

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
