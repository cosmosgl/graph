export type ValidationContract = {
  question: string;
  reference: string;
  acceptance: string;
  coverage: string;
  limits: string;
}

// These describe existing gates, not new pass thresholds or production approvals.
/* eslint-disable @typescript-eslint/naming-convention -- Keys match existing public hash routes. */
export const validationContracts: Record<string, ValidationContract> = {
  'ribbon-generation': {
    question: 'Does WebGPU compute sample reuse reduce complete ribbon drawing cost?',
    reference: 'The existing curved-link WGSL vertex generator, on the same device, inputs, rasterizer and color-face picking policy.',
    acceptance: 'Exact RGBA8 color and ID preservation on the selected scene, nonempty color control and exact static-cache reuse. Cost is separate.',
    coverage: 'Solid rational curves; fixed tessellation, rebuilt and static caches; color-only or color plus IDs; duplicate baseline and balanced timing.',
    limits: 'No independent CPU geometry gate or WebGL equivalence claim. Frozen endpoints model rebuilding cost, not an evolving simulation. ' +
      'Existing curved-link raster failures remain open. Full styles, invalidation integration, culling, adaptive tessellation and cross-device costs are unchecked.',
  },
  'point-styling': {
    question: 'Do production Cosmos styling and shape-aware host picking match a luma WebGPU port and the rendered footprint?',
    reference: 'Unmodified production GLSL with the legacy CPU rule; independent candidate CPU geometry with positive global opacity ' +
      '(visible rule), plus quantized and pick-only candidates with the declared source-alpha rule; offscreen RGBA8 color/ID readback.',
    acceptance: 'Exact IDs and scalar masks at every pixel; at most two RGBA8 channel levels for color; no picked pixels with zero rendered alpha.',
    coverage: 'Frozen eight-shape, overlap, edge-case, fractional and tiny-alpha fixtures, zoom, pixel ratio, strokes, defaults and render order; ' +
      'raw/decoded atlas images, NPOT/non-square layouts, PNG color/alpha normalization and nearest/linear CPU colors; ' +
      'outline/hover/focus rings, greyout layers/opacity, bounded OKLab shades and exact polygon boundary diagnostics; ' +
      'production, explicit-coordinate and isolated-source verdicts stay separate.',
    limits: 'Host picking only. Pointer tolerance, wider codec/color support, broader automatic shades, ' +
      'transitions, occlusion and latency remain separate. ' +
      'Production zero-opacity visibility and fractional compatibility still fail on M3. Candidate opacity 0/0.35/1 is bounded; ' +
      'Pick-only source-byte eligibility preserves colors in the 32-case M3 sweep, faint stack and 40 atlas cases. ' +
      'Original raster/picking and pre-blend-quantization failures stay visible. Clamping passes the bounded 64 × 64 atlas, ' +
      'while its three NPOT/non-square nearest-boundary failures remain as controls. Integer nearest texels with clamped linear ' +
      'sampling pass all 48 static packing cases and 72 sequential raw-image update cases on M3. ' +
      'Premultiplied-bitmap to sRGB ImageData normalization passes 8/8 PNG settings; direct bitmap paths remain rejected. ' +
      'Normalized rings/greyout pass 88/96 M3 rows. The opt-in pixel-space diagnostic passes 86/96; ' +
      'CPU diamond ties and exact color-preservation rejections stay open without a reference/tolerance change. ' +
      'Other codecs, concurrent loading/frames, wide-gamut output, GPU cost and broader devices remain open.',
  },
  'curved-links': {
    question: 'Do production curved solid ribbons and luma WebGPU match the rendered and pickable footprint?',
    reference: 'Unmodified production curved-link GLSL and power-spaced geometry; separate visible-footprint/source-byte IDs; ' +
      'independent scalar triangle-strip masks, blending and RGBA8 colors.',
    acceptance: 'Exact IDs and scalar masks at every pixel; at most two RGBA8 channel levels for color; no picked pixels with zero rendered alpha.',
    coverage: 'Rational quadratic curves, tessellation, weight/bow direction, widths/defaults, blend/hard modes, opacity, zoom, DPR, ' +
      'ordering, overlap and fractional boundaries; original colors and each selected source checked separately.',
    limits: 'Production padded host IDs remain unchanged. Candidate picking changes policy only. Coincident endpoints have undefined production normals. ' +
      'Patterns, arrows, gradients, fading, highlights, transitions, Graph integration, GPU cost and broader devices remain open.',
  },
  'straight-links': {
    question: 'Do production Cosmos straight ribbons and luma WebGPU agree with the rendered and pickable footprint?',
    reference: 'Unmodified production straight-link GLSL and geometry; a separate visible-footprint/source-byte ID candidate; ' +
      'independent scalar ribbon triangles, masks and RGBA8 colors.',
    acceptance: 'Exact IDs and scalar masks at every pixel; at most two RGBA8 channel levels for color; no picked pixels with zero rendered alpha.',
    coverage: 'Straight solid ribbons, widths/defaults, subpixel attenuation, blend/hard modes, opacity, zoom, DPR, ordering, ' +
      'absent endpoints, overlap and fractional/aligned boundary controls. Source checks and original color preservation remain separate.',
    limits: 'Production host picking deliberately adds five CSS pixels of ribbon width. Candidate picking changes that policy, not the production control. ' +
      'Curves, patterns, arrows, endpoint gradients, visibility fading, highlights, transitions, pointer scheduling, full Graph/host integration, ' +
      'broader native devices and runtime GPU cost remain open.',
  },
  'center-mass': {
    question: 'Do blend accumulation and compute reduction calculate the same center accurately?',
    reference: 'Mathematical reference: JavaScript double-precision sum of the uploaded float32 coordinates.',
    acceptance: 'Inspect absolute center error and count; no requirement for identical sum bits and no production accuracy budget yet.',
    coverage: 'The current shared point snapshot; results and device conditions are recorded separately.',
    limits: 'A small center error does not establish center-force composition or long-run layout quality.',
  },
  'scalable-reduction': {
    question: 'Can hierarchical reduction keep large inputs and outputs on the GPU?',
    reference: 'Mathematical control: initial CPU center up to one million points, then idealized center rotation.',
    acceptance: 'Inspect center error, count and reduction completion; the rotated center is not a per-point float32 trajectory oracle.',
    coverage: 'Selected point count; the displayed preview is capped and CPU reference availability is reported.',
    limits: 'Large reductions do not establish large graph layout correctness or universal accuracy.',
  },
  'spatial-grid': {
    question: 'Does count/scan/scatter include each input point exactly once in the correct cell?',
    reference: 'Structural reference: independent CPU histogram, exclusive scan and membership checks.',
    acceptance: 'Exact counts, offsets and membership; order within each cell may differ.',
    coverage: 'Exhaustive validation of the selected build, outside timing.',
    limits: 'Correct cell membership does not establish the accuracy of a force using that grid.',
  },
  'point-rendering': {
    question: 'How do WebGL sprites and WebGPU quads draw the selected circles?',
    reference: 'Matched visual comparison of positions, colors, camera and circle size; no CPU force oracle.',
    acceptance: 'Inspect geometry, coverage and blending; full production visual acceptance is not established.',
    coverage: 'Selected rendering controls and available backends.',
    limits: 'Other shapes, full styling, picking and interaction remain separate.',
  },
  'performance-lab': {
    question: 'What do matched isolated drawing and reduction workloads cost?',
    reference: 'Matched workload controls and a CPU center check; reduction validation runs separately from timed batches.',
    acceptance: 'Report correctness observations, timer validity and timing boundaries separately; a fast row is not production approval.',
    coverage: 'Selected workload, warmups and recorded batches; raw trials are exported.',
    limits: 'Completion includes submission and waiting; these isolated workloads do not measure complete Graph FPS.',
  },
  'neighborhood-forces': {
    question: 'Does the grid find the same local neighbors and forces as exhaustive pair evaluation?',
    reference: 'Structural and mathematical reference: CPU all-pairs cutoff checks with float32 distance classification and double accumulation.',
    acceptance: 'Exact neighbor counts, finite outputs and the existing force/position/velocity tolerances; accumulation order may differ.',
    coverage: 'All points through 1,024; deterministic sampled targets above that, each checked against all sources. Dense diagnostics expand the sample.',
    limits: 'This local-force demo has its own integrator and walls; it is not production global repulsion.',
  },
  'many-body': {
    question: 'Does the exact force preserve production all-pairs semantics?',
    reference: 'Float32 compatibility model: independently coded CPU pair traversal and integration, with analytic pair tests.',
    acceptance: 'Existing mixed force/position tolerances and exact flags; local agreement and independent drift remain separate.',
    coverage: 'All output records in the selected snapshot; repeated fixture ticks in regression tests.',
    limits: 'Matching this operation model is not proof of mathematical optimality or hierarchical accuracy.',
  },
  'many-body-grid': {
    question: 'Is the hierarchical algorithm port faithful, and how much does it approximate exhaustive forces?',
    reference: 'Structural and float32 compatibility models for hierarchy, selected slots and forces; separate exhaustive-pair approximation controls.',
    acceptance: 'Existing structure/force/integration gates; selected identities exact. Approximation error is reported separately from port error.',
    coverage: 'Port checks cover the selected arrays; approximation checks use up to 64 deterministic targets.',
    limits: 'CPU and GPU share algorithm policies; agreement does not independently validate those policies or layout quality.',
  },
  'weighted-links': {
    question: 'Are edge semantics, ordered spring updates and integration between directions preserved?',
    reference: 'Independent CPU edge lists plus a stepwise float32 compatibility model; the reference does not consume GPU CSR.',
    acceptance: 'Existing force and substep tolerances, topology cases, pinning and replacement checks.',
    coverage: 'All records for the selected fixtures and checked ticks.',
    limits: 'Ordered edge updates are algorithm semantics, not an interchangeable reduction order; full renderer behavior remains separate.',
  },
  collision: {
    question: 'Are disc corrections, contact radii, masks and repeated constraint passes preserved?',
    reference: 'Float32 compatibility model of the production all-pairs law, with independent scalar traversal.',
    acceptance: 'Existing force/position gates plus masks, configured passes and cooling behavior; native arithmetic failures remain recorded.',
    coverage: 'Selected exact-path fixtures, checkpoints and probes; see the method for each run.',
    limits: 'The large-graph hash/slot path, broader trajectories and device portability are not established.',
  },
  'repulsion-trajectories': {
    question: 'How do independently evolving hierarchical layouts diverge despite same-input checks?',
    reference: 'Float32 CPU trajectory and same-input local compatibility checks, alongside production GLSL.',
    acceptance: 'Keep local force failures distinct from accumulated drift; a visually close trajectory cannot erase a failed gate.',
    coverage: 'Selected fixtures, run length and documented checkpoint population.',
    limits: 'Trajectory identity is diagnostic, not a universal quality criterion for different algorithms.',
  },
  'combined-layout': {
    question: 'Do composed forces preserve stage behavior and remain numerically consistent over time?',
    reference: 'Float32 compatibility models per stage and whole tick, plus an independent CPU trajectory.',
    acceptance: 'Existing stage, hierarchy and whole-tick tolerances; finite values, exact flags and deterministic failure replay.',
    coverage: 'First/interval/final checkpoints or every-tick diagnostic mode, plus the full-strength probe. Unchecked ticks have no verdict.',
    limits: 'Passing the strict arithmetic candidate is not a production precision policy or a layout-quality approval.',
  },
  'resident-layout': {
    question: 'Does removing routine CPU bounds readback preserve simulation and drawing dataflow?',
    reference: 'Execution equivalence against the staged WebGPU reference; independent CPU bounds and separate force checks.',
    acceptance: 'Bitwise checkpoint equality for the same force implementation; replay, live-edit preservation and timer checks remain distinct.',
    coverage: 'Scheduled checkpoints; unchecked resident ticks perform no position readback. Timing uses separate validated batches.',
    limits: 'Shared force code can share a bug; dataflow equality does not independently establish force accuracy.',
  },
  'matched-layout': {
    question: 'Do production GLSL, WebGPU and CPU retain comparable behavior and layout quality?',
    reference: 'Float32 compatibility trajectory and frozen common-input checks; center aggregate uses a double-precision CPU sum.',
    acceptance: 'Existing numerical gates, exact flags and diagnostic restoration. Quality/drift are measured without an acceptance threshold.',
    coverage: 'First/interval/final ticks and probes; every lane evolves independently but adaptive sampling decisions come from one CPU tape.',
    limits: 'No independent runtime adaptation, complete behavioral certification, mathematical accuracy gate or end-to-end performance claim.',
  },
  'layout-acceptance': {
    question: 'Do candidate arithmetic, routing, sampling and updates pass the existing bounded production-setting gates?',
    reference: 'Float32 CPU compatibility checks and strict WebGPU controls with deterministic fixtures.',
    acceptance: 'Preserve original tolerances, exact/grid routing boundaries, state retention and all recorded failures.',
    coverage: 'Selected settings and scheduled checkpoints, including bounded long runs; see each findings matrix.',
    limits: 'Production-setting checks do not approve all parameters, runtime scheduling, layout quality or other GPUs.',
  },
  'gpu-stage-profile': {
    question: 'Which GPU stages dominate a controlled resident frame?',
    reference: 'Frozen common inputs, strict baseline, CPU compatibility gates and exact instrumentation replay.',
    acceptance: 'Existing numerical gates and replay equality before interpreting stage timings; normal frames are measured separately.',
    coverage: 'Selected fixtures, balanced execution order and exported trials.',
    limits: 'Instrumented stages are diagnostics; their sum is not automatically normal frame latency.',
  },
  'hub-springs': {
    question: 'Can cooperative neighbor prefetch improve hub cost without changing ordered spring semantics?',
    reference: 'Strict baseline, independent CPU compatibility checks and evolving trajectory controls.',
    acceptance: 'Original spring gates and exact replay; compare normal-frame timings separately from stage diagnostics.',
    coverage: 'Selected hub degrees, cutoffs, fixtures, schedules and native device.',
    limits: 'A local cutoff or speedup is not a universal policy; broader multi-hub graphs and devices need evidence.',
  },
  'cell-aggregation': {
    question: 'Can membership caching and bounded sorting preserve aggregation while reducing frame cost?',
    reference: 'Strict baseline with source-index-ordered sums, CPU compatibility gates and duplicate-baseline controls.',
    acceptance: 'Exact aggregate/centroid bits where promised, existing whole-tick checks and separate normal-frame measurements.',
    coverage: 'Selected occupancy distributions, counts and native-device trials.',
    limits: 'Bitwise baseline equality tests this optimization; it does not require every future reduction algorithm to retain source order.',
  },
  'point-capacity': {
    question: 'Can logical count change while preserving resident state and resource ownership?',
    reference: 'CPU-copy and GPU-rebuild controls, expected prefix/tail records and subsequent CPU compatibility checks.',
    acceptance: 'Exact surviving records, fresh tails, pins, absence, tick/cooling and cleanup; subsequent frame checks remain separate.',
    coverage: 'Selected grow/shrink/regrow cycles on the same lane-owned device, including retained-capacity updates.',
    limits: 'Full public setters, transitions, host ownership, recovery and total VRAM budgets remain separate.',
  },
  'precision-diagnostics': {
    question: 'Are differences caused by the gravity formula, arithmetic evaluation or accumulation order?',
    reference: 'Analytic linear gravity, legacy float32 polar model, and exact bounded-integer sum fixtures.',
    acceptance: 'Report mathematical error and compatibility differences separately; no new production acceptance threshold.',
    coverage: 'Frozen finite float32 inputs; production GLSL gravity, native WGSL alternatives and controlled sum kernels.',
    limits: 'No trajectory, complete-runtime, strict-candidate or performance approval; arithmetic causes remain hypotheses unless isolated.',
  },
}

/* eslint-enable @typescript-eslint/naming-convention */

export function validationContractMarkdown (id: string, includeQuestion = true): string {
  const contract = validationContracts[id]
  if (!contract) throw new Error(`Missing validation contract: ${id}`)
  const introduction = includeQuestion
    ? `This contract describes what this experiment checks. It is not a live run result.

## Question

${contract.question}

`
    : ''
  return `${introduction}## Reference

${contract.reference}

## Acceptance

${contract.acceptance}

## Checked population

${contract.coverage}

## Limits

${contract.limits}

Use the [validation workflow](#/validation-workflow) to classify a difference and the
[numerical research report](#/numerical-research) for the specification basis.
Record backend, browser, device, inputs, checked population and raw failures with every finding.
`
}
