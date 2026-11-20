Preserve Cosmos's behavioral contracts while allowing WebGPU to use different
storage, execution and numerically sound algorithms. CPU and WebGL results are
evidence with a stated purpose, not universal ground truth. Historical strict
checks remain unchanged; the first migration has a separate practical contract.

## First migration rules

First-slice scope agreed **17 November 2026**. The goal is a useful,
integrated WebGPU backend on the current Apple M3 and native browser.
The integrated candidate has bounded M3 evidence, including passing
small-graph checks and recorded large-star and intermittent latency failures.
[Integrated candidate](#/integrated-webgpu) · [Migration roadmap](#/roadmap)

### Supported first slice

- Circle points and solid straight links, with colors, sizes and opacity.
- Repulsion, weighted springs, gravity, center and cooling, reusing the tested
  corrected arithmetic rather than reopening precision optimization now.
- Resident GPU positions shared by simulation and drawing, through public
  luma APIs and the pinned `10.0.0-alpha.15` package family.
- Point picking, dragging, pan/zoom, basic data replacement and pause/resume.
- Current native machine first; production Cosmos remains on its existing
  WebGL/luma version until a separate adoption decision.

Curved/patterned links, arrows, images, decorative rings, advanced transitions,
clusters, per-point attractors, mouse repulsion and host/deck integration are
outside this first slice. Point dragging does not imply mouse-repulsion support.
Collision remains a separate bounded option until composed behavior and cost are
measured. Unsupported options must be identified explicitly, not silently ignored.
Full feature migration remains the destination.

### Practical acceptance

| Area | Required | Acceptable difference for this first slice |
|---|---|---|
| Data and topology | Correct endpoints, weights, stable IDs, absence and pinned state | None in these discrete contracts |
| Simulation | Finite, stable layouts; intended forces and comparable convergence on selected graphs | Small coordinate differences without material layout degradation; identical trajectories are not required |
| Rendering | Correct shapes, widths, colors, ordering and transparency | Minor boundary/antialiasing differences under the boundary rule below |
| Picking | Correct visible source and overlap order; hidden sources cannot intercept selection | Selectable edges can differ slightly between backends under the declared visible-footprint policy |
| Interaction and lifecycle | Pan, zoom, dragging, updates, pause/resume, resize and destruction work together | Advanced unsupported features are explicitly outside scope |
| Responsiveness | No meaningful slowdown against the current production WebGL Graph on matched workloads | Declare a tolerable slowdown for each measured workflow before judging WebGPU |

**Rendering boundary rule:** allow at most one device pixel of boundary
displacement between backends for this practical assessment. Keep the existing
2/255 channel budget away from the boundary. Determine the boundary from the
object geometry/reference, not by marking every failed pixel as an edge. Record
boundary mismatches separately. This allowance must not excuse disappearing thin
links or points, wrong interior colors/IDs, obvious flicker or lost objects. A
thin object does not become exempt merely because all its pixels are near edges.
Inspect motion, fractional zoom and pixel ratios 1 and 2, not only still images.

**Picking remains a behavior check:** exact object identity and ordering matter.
A small difference in the two backends' selectable silhouettes is allowed; an
invisible foreground intercepting a visible object is not. Check each selected
source's own visibility, not only the final composed frame's alpha. Production's
padded picking policy stays a comparison control; it is not silently redefined.

**Simulation remains accountable:** retain existing stage/checkpoint tests and
compare quality separately. Use the already-tested corrected solver initially.
Record convergence, overlap, stress and residual motion on matched workloads;
cooled stillness alone is not proof of a useful layout. Quality metrics without
an agreed numerical budget stay “Measured only.” Do not invent a tolerance after
seeing a failure. A practical pilot decision may use a documented side-by-side
quality review while strict compatibility remains failed or unassessed.

### Performance against production WebGL

Run the production WebGL Graph and the WebGPU candidate on the same
machine and browser. Match graph data and starting layout, enabled forces
and cooling, styles, camera, canvas size and pixel ratio, and the interaction
sequence. Use normal application render loops. Require comparable layout and
rendered output so each timed run delivers the same functionality.
[Viewer Comparison benchmark](#/viewer-comparison?section=doc-migration-benchmark)

Repeat the WebGL control to estimate normal variation. Before judging the
candidate, declare how much slower each user-facing metric can be, based on
that variation and the impact on users. Repeat paired runs in fresh browser
sessions and alternate which backend runs first. For each workload, report
both timings and their difference in milliseconds and percent. Performance
passes when the candidate stays within the declared limits without new
recurring stalls. Use **Not assessed** when the matched baseline or limits
are missing. Repeat inconclusive runs.

Measure p95 frame intervals during steady motion and interactions. Time
actual graph updates and record skipped animation opportunities. Measure
pick and drag feedback from the same input event to the updated frame on
both backends. Include p95, the slowest samples and the first request.
Compare cold startup, graph updates, selection and labels where supported.
Track peak GPU allocation and record what each measurement includes.

If a backend cannot complete a fixture, record the failure and the
largest tested workload it completes. Assess the new capacity against
the declared workload and quality requirements. A speed comparison needs
completed matched runs. The 33 ms frame and 50 ms pick references describe
the earlier pilot studies. Set any absolute responsiveness requirement
for the intended product workload explicitly.

### Workload and measurement

Start with chain, communities and star at about 1,000 points, then 8,192. The
[M3 acceptance scope](#/million-graph?section=doc-production-envelope) names the
real graph and larger workloads. Record link count, seed, settings, cooling
schedule, viewport, pixel ratio, browser, device and luma version. The
[8,192-point community checkpoints](#/integrated-webgpu?section=doc-composed-interaction)
include two hashed collision passes. The live chain and star timings used
collision off.

Compare moving and settled layouts. Exercise repeated updates, dragging, resize,
pause/resume and teardown. Measure the complete supported workload without
validation readbacks in the timed path. Report steady-state frame intervals
separately from initialization and uploads; record picking request-to-visible-
feedback latency, including scheduling and readback. Declare the measurement
window and input sequence before each run. Keep GPU timestamps, CPU submission
and end-to-end responsiveness distinct. Use end-to-end measurements for the
performance verdict. Raw captures remain local exports.

### Verdicts and stopping rule

Keep **strict compatibility**, **first-migration usability** and **full migration
readiness** separate. Historical failures remain failures under their original
rules. “Usable for the first slice” must name the supported features, tested
workloads, machine and accepted differences. Until that assessment is actually
run, the practical verdict is **Not assessed**.

Investigate further when a difference breaks behavior, is visibly distracting,
destabilizes a layout, exceeds the boundary rule or causes a meaningful slowdown
against the matched WebGL control. Otherwise, record it and continue integration.
Profile the integrated application before optimizing arithmetic or adding
expensive exact picking paths.
Do not require a green broad GPU suite to continue this research.

A parked investigation is **stopped for the first attempt, not resolved**. Retain
its inputs, original verdicts, evidence, reproduction instructions and reason for
stopping. Reopen it if the integrated slice exposes a practical problem or when
its feature enters scope. Before declaring full migration readiness, review every
parked item: resolve it, validate a replacement, or explicitly approve a supported
behavioral difference. If a feature is still excluded, do not claim complete
Cosmos parity. Full readiness concerns a declared feature/device/workload envelope,
not a promise of identical results on every GPU. The [parked investigations](#/roadmap?section=parked-investigations) section
tracks these return conditions; deeper research may be necessary **before** full
approval, not after it.

## Local research scope

As of **17 November 2026**, run focused experiments on the machine doing the
investigation, using its native GPU and browser. The lab has no required CI tests
or software-GPU investigation workflow. Optional local UI, lint, typecheck and
build commands help keep the research tool usable; a broad green suite is not a
prerequisite for the next experiment.

Keep failed-candidate verdicts and existing acceptance criteria intact. A finding
on one device is evidence for that device, not portable production approval.
Historical Linux/SwiftShader results remain recorded, but their discrepancies do
not need to be resolved before local research continues. Broader device testing
can be chosen later if it answers a migration decision.

## 1. Declare the comparison

Every experiment has a **What we compare** section: question, reference, acceptance rule, checked
population and limits. Contracts describe checks, not results from a run. New experiments must add
their contract in `src/runtime/validation.ts`; registration rejects a missing contract.

| Reference | Answers | Does not establish |
| --- | --- | --- |
| Mathematical reference | Accuracy against the intended formula, using analytic results or suitably stable higher precision | Exact real arithmetic for arbitrary inputs |
| Float32 compatibility model | Agreement with a documented traversal and rounding sequence | That the sequence is mathematically preferable or required by GPU specifications |
| Structural reference | Correct indices, membership, topology, counts and masks | Accurate floating-point forces or useful layouts |
| Execution reference | Equivalent staged/resident, rebuilt/retained or instrumented/normal work | Independent accuracy when both paths share a force implementation |

Keep exact requirements for IDs, flags, retained state and other discrete contracts. Floating-point
outputs need an explicit accuracy or compatibility budget. Different algorithms may need different
references. Do not add multiple CPU implementations unless they answer distinct questions.

## 2. Separate verdicts

Report **behavior**, **numerical accuracy**, **legacy compatibility**, **layout quality** and
**performance** separately. Use **Not assessed** when the relevant check or acceptance threshold
does not exist. Describe limited behavior checks, such as flags and restoration, by name; they do
not certify the complete API. Measured quality without an agreed threshold is **Measured only**.

A compatibility failure remains a failure under its original rule. It does not automatically prove
an inaccurate result, a driver bug, or an acceptable alternative. Preserve it and add evidence under
the appropriate independent contract. A complete or finite run alone is not a numerical pass.

The matched-layout UI and JSON expose these categories. Other experiments retain their detailed
run reports; their shared contract explains how to interpret the existing gates. Historical JSON
and findings retain their original meaning.

## 3. Investigate consequential differences

Prioritize wrong discrete decisions, errors beyond a justified budget, instability and precision
corrections with substantial cost on the current machine. Do not investigate every differing bit.

```flow
Freeze input · Float32 positions, uniforms, seed, topology, traversal and force order
Check structure · Indices, masks, cutoffs and selected neighbors
Check contributions · Isolate pair or force calculations before summing
Check accumulation · Re-sum identical captured contributions in several orders and higher precision
Check integration · Apply captured forces separately; inspect cancellation and step guards
Check evolution · Independent trajectories, sampling decisions and quality
Retain a fixture · Reproduce the earliest meaningful failure and verify a targeted correction
```

Instrumentation must reproduce the ordinary output before it explains that output. Record a cause
as a hypothesis when observations cannot distinguish compiler fusion, reassociation or approximation.
Define a finite input domain and handle absence explicitly: WGSL permits finite-math assumptions,
so CPU NaN arithmetic is not a portable absence policy.

Stop arithmetic investigation when cause and practical impact are sufficiently understood to
classify the result. Escalate a suspected implementation violation using a small case and the
applicable specification rule. An application budget may intentionally be tighter than that rule.

## 4. Choose and verify budgets

Keep historical tolerances for compatibility. Define new accuracy budgets before selecting a
candidate, using force magnitudes, displacement, documented problem scales and representation limits.
Inspect absolute error near zero; a relative-only comparison breaks down under cancellation.
Report arithmetic error separately from hierarchical approximation error.

Current position-relative compatibility limits depend strongly on world coordinates. With
`2e-5 + 3e-5 * abs(reference)`, the allowance is `0.00002` at zero and `0.06146` at 2048.
These are the existing rules, not proposed accuracy targets. Keep force checks and add translated
fixtures with the origin and constraints translated consistently. Do not compare position pass
counts across coordinate frames as if their budgets were identical.

Verify CPU models with small analytic cases and applicable properties. Do not impose conservation,
permutation invariance or rotational invariance on forces whose jitter, directional order, pins or
grid approximation intentionally break those properties. Use exhaustive checks on small inputs and
explicit samples on larger ones; sampled checks and checkpoint intervals leave unchecked cases.

## 5. Evaluate runtime and cost independently

Use the [precision diagnostics](#/precision-diagnostics) for bounded gravity and cancellation studies.
It compares mathematical error with compatibility differences without selecting a production policy.
Then validate candidate integration and independently evolving layouts in the existing experiments.

Keep deterministic shared sampling for controlled port comparisons. Also require independently
adapting runtime tests before production approval; the matched comparison's CPU sampling tape does
not validate runtime scheduling. Evaluate several graph families, seeds and intended native devices.
Agree quality, startup, update and memory requirements for the supported
features. Use the WebGL control for migration timing. [Performance rule](#performance-against-production-webgl)

Keep CPU prediction and validation readback outside timed work. Name GPU timestamp, CPU submission
and synchronized completion separately; identify excluded setup, uploads, presentation and features.
Compare cost at accepted output quality. Bitwise execution replay and independent numerical accuracy
are different gates even when both run after a timing batch.

## 6. Record findings

For each finding record: intended contract; reference and its limitations; frozen inputs and checked
population; environment and implementation version; observed error and budget; earliest failing
stage; evidence for the cause; behavior/quality impact; paired cost; and reproduction steps.

Classify existing WebGL issues as well as WebGPU issues. If an old implementation violates intended
behavior, retain its failing fixture and decide the correction explicitly instead of preserving it
as a compatibility requirement. Keep existing failures and new acceptance decisions separately
visible. No new tolerance is justified solely because a faster candidate fails the old one.

See the [research report](#/numerical-research) for source-backed findings and the remaining experiments.
