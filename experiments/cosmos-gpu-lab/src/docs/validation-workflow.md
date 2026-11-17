Preserve Cosmos's behavioral contracts while allowing a WebGPU implementation to use different
storage, execution and numerically sound algorithms. CPU and WebGL results are evidence with a
stated purpose, not universal ground truth. Existing numerical gates remain unchanged.

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
Agree quality, frame-time, update and memory budgets for the supported feature set.

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
