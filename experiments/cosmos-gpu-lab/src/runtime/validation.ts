import { selectionCase } from '../experiments/selection/case'
import { cases as pointStylingCases, pointStylingExperimentIds } from '../experiments/point-styling/cases'

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
  ...Object.fromEntries(pointStylingCases.map(item => [pointStylingExperimentIds[item.id], {
    question: item.question,
    reference: item.reference,
    acceptance: item.acceptance,
    coverage: item.recorded.scope,
    limits: item.recorded.limits,
  } satisfies ValidationContract])),
  'million-graph': {
    question: 'How does shared repulsion change the layout, and how responsive is the moving graph through a million points?',
    reference: 'Matched per-point force runs, frozen paint layers, and expected IDs and camera behavior during native input.',
    acceptance: 'Keep flags, pins and pick results exact. Check local pixel drift and report frame and pick timings with the study’s reference values.',
    coverage: 'Uniform and dense layouts on M3, frozen draw passes, and pan, zoom and picks on moving dense and high-degree graphs.',
    limits: 'The local study uses basic styles and a partial force set. Matched production WebGL timing, full drawing and portability remain open.',
  },
  'mouse-repulsion': {
    question: 'Does WebGPU match Cosmos mouse repulsion and its independent execution gate?',
    reference: 'Production ForceMouse GLSL and an independent CPU force and integration reference.',
    acceptance: 'Use existing force and position tolerances with exact fixed-point state. Retain the measured legacy result at exact coincidence.',
    coverage: 'Twelve edge cases plus deterministic 1,024- and 8,192-point inputs. Check pan, zoom, resize, running, paused and released pointer behavior.',
    limits: 'The isolated study covers the pointer force and integration. Full-frame costs and remaining forces need a composed run.',
  },
  'point-attractors': {
    question: 'Can WebGPU preserve Cosmos per-point target/strength rules and live updates at useful cost?',
    reference: 'Unchanged production attractor GLSL and integrator; independent raw-channel CPU reference.',
    acceptance: 'Existing force gate: absolute 2e-5 + relative 3e-5 per XY component, exact flags; disabled-stage positions exactly unchanged.',
    coverage: 'Isolated force: 12-point semantics and 1,024/8,192 shared, individual, mixed and translated inputs; sampled trajectories and live updates.',
    limits: 'No combined-force, full-frame, long cooling, production setter/transition or full migration acceptance.',
  },
  'cluster-attraction': {
    question: 'Can WebGPU preserve Cosmos cluster attraction and membership updates at useful cost?',
    reference: 'Unchanged production cluster GLSL and integrator; independent scalar CPU group sums and float32 force reference.',
    acceptance: 'Existing force gate: absolute 2e-5 + relative 3e-5 per XY component, exact counts and flags; retain every failed control.',
    coverage: 'Isolated clusters: 8-point semantics, 1,024 and 8,192 balanced/uneven/single-group/custom-target inputs; sampled independent trajectories and updates.',
    limits: 'No community detection, combined-force or complete-frame acceptance, production API/labels validation or migration approval.',
  },
  'smoothstep-coverage': {
    question: 'Does changing the order of smoothstep edges change the observed straight-link pixels?',
    reference: 'The original production WebGL and WebGPU stroke expressions; identical float32 probe inputs and the independent scalar ribbon model.',
    acceptance: 'Report coverage, color and ID changes separately. Keep the existing straight-link strict gates and original colors visible; ' +
      'this diagnostic does not approve a replacement.',
    coverage: 'One width-3 line, hard/blended and fractional shifts; fixed inputs around a 0.5 tie; matched-corner position traces and 17 lengths.',
    limits: 'Separate probes can compile differently and cannot reveal the driver’s internal interpolation. Caps, arrows, patterns, other devices, ' +
      'full Graph interaction and performance are not assessed.',
  },
  'pilot-viewer': {
    question: 'Can the bounded WebGPU backend support a useful Karate Club exploration workflow?',
    reference: 'Existing corrected integrated runtime, original Karate topology, sampled CPU pixel audit and retained production viewer comparison.',
    acceptance: 'Pilot timing checks require at least 95% of complete intervals <= 33 ms and input feedback <= 50 ms. ' +
      'Check exact IDs, visible picks and the 2/255 interior color limit beyond a one-device-pixel geometric boundary.',
    coverage: '34-member / 78-link Karate Club explorer on native M3; controlled intervals and interaction, native exploration and degree sizes.',
    limits: 'Research-only pilot. Strict production color compatibility remains rejected; ' +
      'larger viewer workloads, full API and full migration are not approved.',
  },
  'production-graph-api': {
    question: 'Do the built packages draw, pick and track the same points as they move, disappear and return?',
    reference: 'Known IDs, the WebGL canvas during position edits, and each engine’s full YouTube position snapshot at release.',
    acceptance: 'Keep the manual-step pin and absent slot. Match every pixel, click ID and surviving position in the removal replay. ' +
      'Match the hover ring and callback sequence as points and the camera move under a stationary cursor. ' +
      'Check point colors, sizes and endpoint gradients through an interruption. WebGPU edge clicks must follow the displayed diameter. ' +
      'Match each headless tracker to the full position read, including the surviving group after the other is destroyed. ' +
      'Return exact ordered IDs and coordinates for 1,000 labels per YouTube drag.',
    coverage: 'Manual gravity and clicks, removal and hover at 1× and 2×, two headless trackers, and four moving rectangles at two YouTube sizes on M3.',
    limits: 'The YouTube replay uses a fixed camera, two-pixel points and one native GPU. The two running simulations can reach different layouts at release.',
  },
  'production-lines': {
    question: 'Does the same link draw at the same pixels and return the same ID in both Graph packages?',
    reference: 'The built WebGL Graph drawing the same endpoints, widths, styles and camera, plus independently specified pointer targets.',
    acceptance: 'Compare every RGBA pixel and report exact differences. Check the stroke and the expected point, link or background at each probe.',
    coverage: 'Links, styles, hover and zoom at pixel ratios 1 and 2. Sweep opposite-facing dashed and solid caps forward and back in 1/32-device-pixel steps.',
    limits: 'Small deterministic fixtures exercise individual features. The shared stories also exercise controls on larger graphs.',
  },
  'production-forces': {
    question: 'How do individual forces and their combination move the same graph when both packages receive the same public calls?',
    reference: 'The built WebGL Graph stepped from identical inputs, with independent checks on direction, pins and absent slots.',
    acceptance: 'Compare coordinates at fixed ticks, preserve pinned and absent slots and measure the approximate repulsion trajectory against the reference.',
    coverage: 'Isolated forces, eight slots with three forces, and 8,192-slot dense and hub graphs with springs, repulsion and collision through 100 ticks.',
    limits: 'The scaled checks cover one seed per topology. Native timing uses one moving Graph and trusted clicks on known targets.',
  },
  'production-points': {
    question: 'Do all eight point shapes produce identical pixels in the WebGL and WebGPU Graph packages at pixel ratios 1 and 2?',
    reference: 'The built WebGL Graph, drawing the same point indices, sizes, positions, camera, fill and background as the built WebGPU Graph.',
    acceptance: 'Exact parity requires zero differing RGBA pixels over the complete canvas. Each sample must have the expected opaque center.',
    coverage: 'All eight shapes at four fractional CSS diameters. Compare integer centers, CSS offsets (0.25, 0.375) and (0.1, 0.4), ' +
      'and 32 positions halfway between 1/16-device-pixel grid lines. Include 22 and 24 CSS pixel controls at both ratios in the 264 × 152 CSS pixel viewport.',
    limits: 'The fixture covers static opaque fills and the sampled sizes and centers. It does not exercise strokes, images, rings or picking.',
  },
  'production-force-collision': {
    question: 'Do the two Cosmos Graph packages move and draw colliding points identically at the same tick?',
    reference: 'The built workspace WebGL Graph, with the same public calls, point order, seed, camera and tick as the built WebGPU Graph.',
    acceptance: 'An exact position match requires equal x and y for every slot, including matching absent slots. ' +
      'An exact rendering match requires identical RGBA bytes at every pixel of the two populated canvases.',
    coverage: 'Seven slots exercise all-pairs collision. Adding 4,090 offscreen points exercises hashed collision at 4,097 slots. ' +
      'Both cases use unequal sizes, a pinned contact, a free isolated point, and an absent slot at a fixed 256 × 192 viewport and pixel ratio 1.',
    limits: 'The full position array includes the offscreen points. Rendering covers the visible cluster. Other forces, dense hash buckets and frame timing are outside these checks.',
  },
  'viewer-comparison': {
    question: 'Can the small candidate viewer support the production appearance, update and running-interaction workflow?',
    reference: 'Unchanged workspace production Graph with luma v9, corrected integrated luma v10 runtime, ' +
      'supplied styles and independent candidate pixel audit.',
    acceptance: 'Small-graph timing checks use 95% of complete intervals <= 33 ms and feedback <= 50 ms. ' +
      'Check exact IDs, visible picks and <= 2/255 interior color error outside a geometric one-device-pixel boundary.',
    coverage: 'Karate Club 34/78; early/cooled views, point/link styles, 32-point replacement, running picks/drags, resize and recreation on native M3.',
    limits: 'Public host-driven production scheduler, not its default autonomous loop. Independent trajectories are quality observations. ' +
      'Strict compatibility and full migration remain unapproved.',
  },
  'dense-communities': {
    question: 'How do the same eight communities look as they move?',
    reference: 'Production WebGL with the same starting positions, links, styles and camera.',
    acceptance: 'Compare the initial layout, motion and the view while panning, zooming and fitting both graphs.',
    coverage: 'One million points and 999,990 short local links across eight communities.',
    limits: 'Both live viewers share one GPU. The recorded benchmark ran the viewers separately.',
  },
  'hub-communities': {
    question: 'How does a highly connected hub move in the two viewers?',
    reference: 'Production WebGL with the same starting positions, links, styles and camera.',
    acceptance: 'Compare the motion of the hub and its neighbors under the same camera.',
    coverage: 'One million points and 999,990 links, with 8,192 links using one free point as their source.',
    limits: 'Both live viewers share one GPU. The recorded benchmark ran the viewers separately.',
  },
  'youtube-network': {
    question: 'How do both viewers draw and move the same real friendship network?',
    reference: 'Production WebGL with the same starting positions, links, styles and camera.',
    acceptance: 'Inspect each moving layout from the same camera.',
    coverage: 'SNAP YouTube presets with 1,000,000 points and 2,852,734 links, 262,144 points and 1,369,771 links, or 300,000 points and 300,000 links.',
    limits: 'Use solo playback for individual rates. At one million points, recorded WebGL playback stopped at moving rectangle selection.',
  },
  selection: {
    question: selectionCase.question,
    reference: selectionCase.reference,
    acceptance: 'The recorded checks require exact ordered ID agreement across WebGL, WebGPU and the CPU reference.',
    coverage: selectionCase.recorded.scope,
    limits: selectionCase.recorded.limits,
  },
  'integrated-webgpu': {
    question: 'Can one WebGPU graph simulate, draw and respond to interaction?',
    reference: 'The same resident positions feed the simulation, circle and link drawing, and point picking.',
    acceptance: 'Observe layout motion, point selection and dragging. The linked benchmarks apply the original timing and sampled-pixel gates.',
    coverage: 'Core and composed forces, circle points, straight links, camera controls and point interaction.',
    limits: 'Exploratory viewer with fixed screen-space styling. See the recorded evidence for the measured devices and workloads.',
  },
  'integrated-webgpu-benchmarks': {
    question: 'Can one resident WebGPU runtime provide a usable first Cosmos migration slice?',
    reference: 'Existing corrected simulation backend; independent sampled CPU circle/straight-link geometry and IDs; declared M3 interaction workload.',
    acceptance: 'Pilot timing checks use 95% of complete intervals <= 33 ms and pick feedback <= 50 ms. Require no interior ID errors or invisible picks ' +
      'and <= 2/255 color error away from a geometry-derived one-device-pixel boundary.',
    coverage: 'Core forces, circles, solid straight links, point picking/dragging, camera, replacement, pause, resize and destruction. Local sampled evidence only.',
    limits: 'No strict compatibility or full migration approval. Historical failures remain. Faint nonzero opacity < 0.02 and advanced features are explicitly unsupported. Browser feedback is a GPU-completed presentation opportunity, not measured physical scanout.',
  },
  'ribbon-generation': {
    question: 'Does WebGPU compute sample reuse reduce complete ribbon drawing cost?',
    reference: 'The existing curved-link WGSL vertex generator, on the same device, inputs, rasterizer and color-face picking policy.',
    acceptance: 'Exact RGBA8 color and ID preservation on the selected scene, nonempty color control and exact static-cache reuse. Cost is separate.',
    coverage: 'Solid rational curves; fixed tessellation, rebuilt and static caches; color-only or color plus IDs; duplicate baseline and balanced timing.',
    limits: 'No independent CPU geometry gate or WebGL equivalence claim. Frozen endpoints model rebuilding cost, not an evolving simulation. ' +
      'Existing curved-link raster failures remain open. Full styles, invalidation integration, culling, adaptive tessellation and cross-device costs are unchecked.',
  },
  'curved-links': {
    question: 'Do production curved solid ribbons and luma WebGPU match the rendered and pickable footprint?',
    reference: 'Unmodified production curved-link GLSL and power-spaced geometry; separate visible-footprint/source-byte IDs; ' +
      'independent scalar triangle-strip masks, blending and RGBA8 colors.',
    acceptance: 'The preview checks exact IDs and CPU masks, colors within 2/255 and source visibility for unpadded picks. The frozen pilot suite checks thin strokes, overlap order and a one-device-pixel edge allowance with production padded picking.',
    coverage: 'Live solid bows, a folded ribbon and crossing curves with hard or antialiased edges and three picking rules. ' +
      'Recorded sweeps also varied geometry, zoom, pixel ratio, opacity, ordering, patterns and endpoint colors.',
    limits: 'Solid curves enter the pilot with production padded picking. Drawn-face results cover a different click target. Coincident endpoints have undefined production normals. ' +
      'Other pattern parameters, arrows, fading, highlights, transitions, Graph integration, GPU cost and broader devices remain open.',
  },
  'straight-links': {
    question: 'Do production Cosmos straight ribbons and luma WebGPU agree with the rendered and pickable footprint?',
    reference: 'Unmodified production straight-link GLSL and geometry; a separate visible-footprint/source-byte ID candidate; ' +
      'independent scalar ribbon triangles, masks and RGBA8 colors.',
    acceptance: 'For solid links, require exact IDs and color agreement within 2/255 outside a one-device-pixel outline band. ' +
      'Thin links must remain visible and invisible sources must never intercept visible-stroke picks. Archived matrices use strict pixel boundaries.',
    coverage: 'Live scenes cover solid links, width limits, fractional edges, overlap, endpoint colors and pattern gaps. ' +
      'The archived sweeps also varied opacity, zoom, pixel ratio and draw order.',
    limits: 'Production host picking deliberately adds five CSS pixels of ribbon width. Candidate picking changes that policy, not the production control. ' +
      'Curves, other pattern parameters, arrows, visibility fading, highlights, transitions, pointer scheduling, full Graph/host integration, ' +
      'broader native devices and runtime GPU cost remain open.',
  },
  'center-mass': {
    question: 'Do blend accumulation and compute reduction calculate the same center accurately?',
    reference: 'Mathematical reference: JavaScript double-precision sum of the uploaded float32 coordinates.',
    acceptance: 'The original demo reports center error and count. The M3 study retains its named strict sum and force checks; ' +
      'visual quality is assessed separately.',
    coverage: 'The original moving snapshot and the separately recorded M3 scale, frame and trajectory workloads.',
    limits: 'Finite or close centers do not establish long-run layout quality or million-point complete-graph readiness.',
  },
  'scalable-reduction': {
    question: 'Can hierarchical reduction keep large inputs and outputs on the GPU?',
    reference: 'Mathematical control: initial CPU sum and idealized rotation. The demo caps the CPU check at one million points.',
    acceptance: 'Check exact counts and finite coordinates. At tick zero and after one rotation, the automated center error budget is one float32 epsilon.',
    coverage: 'Selected point count; the displayed preview is capped and CPU reference availability is reported.',
    limits: 'Large reductions do not establish large graph layout correctness or universal accuracy.',
  },
  'spatial-grid': {
    question: 'Does count/scan/scatter include each input point exactly once in the correct cell?',
    reference: 'Structural reference: independent CPU histogram, exclusive scan and membership checks.',
    acceptance: 'Exact counts, offsets and membership; order within each cell may differ.',
    coverage: 'Exhaustive checks outside timing. Recorded fixtures cover uniform, diagonal and clustered points, including a repeated three-level scan.',
    limits: 'Correct cell membership does not establish the accuracy of a force using that grid.',
  },
  'point-rendering': {
    question: 'How do WebGL sprites and WebGPU quads draw the selected circles?',
    reference: 'Both previews draw the same clip-space positions, colors and diameter in drawing-buffer pixels.',
    acceptance: 'Visual inspection of the geometry, edge coverage and blending in the demo shaders.',
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
  'workgroup-repulsion': {
    question: 'Can small GPU workgroup memory replace the large temporary repulsion buffer?',
    reference: 'The hierarchical WebGL and float32 CPU controls, plus the stored WebGPU force in the recorded investigation.',
    acceptance: 'Keep structure, force and integration checks unchanged; record strict failures separately from layout observations.',
    coverage: 'Live same-input checks through 16,384 points; recorded bounded trajectories and an isolated million-point force.',
    limits: 'The million-point force uses a prebuilt grid. Full-graph performance and a scalable GPU grid builder are not established.',
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
    question: 'Can GPU bounds avoid per-step position downloads and preserve the layout?',
    reference: 'Two luma.gl WebGPU paths share the input, forces and drawing. One calculates bounds on the CPU.',
    acceptance: 'Zero routine position downloads and matching bits for bounds, positions, forces, and grid data at scheduled checks.',
    coverage: 'Five checks over 20 steps for the live 128-point chain. Recorded tests replayed four graph shapes at 128 and 8,192 points.',
    limits: 'The paths share force code. The comparison checks where the work runs and whether the layouts agree.',
  },
  'resident-layout-edits': {
    question: 'Can a running layout accept position and link edits without restarting?',
    reference: 'Apply the same edit to both WebGPU paths and compare their next step.',
    acceptance: 'Preserve the step, cooling and position buffers through the edit. The next checked step must match.',
    coverage: 'One point patch and topology replacements within the current point count.',
    limits: 'The replay covers immediate updates on lane-owned devices. Public setters and device recovery require separate validation.',
  },
  'resident-frame-timing': {
    question: 'How much GPU work do the first few steps take with and without drawing?',
    reference: 'Use the same initial graph and batch length for simulation alone and simulation with drawing.',
    acceptance: 'Replay positions and forces must match. Report GPU timestamps, CPU submit time and time through completion separately.',
    coverage: 'Up to 16 evolving frames per batch, with two warmups and seven samples per workload.',
    limits: 'The run uses a minimal offscreen renderer. Interactive frame latency is measured in the viewer studies.',
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
    question: 'How does reusing GPU buffers affect update time and buffer memory?',
    reference: 'Rebuild the GPU buffers at each change using the same chain graph and point counts.',
    acceptance: 'Measure each update through GPU completion and report the tracked buffer memory after it finishes.',
    coverage: 'One chain graph grows from 2,048 to 8,192 points and returns to 2,048 through four changes.',
    limits: 'Full public setters, transitions, host ownership, recovery and total VRAM budgets remain separate.',
  },
  'point-buffer-copy': {
    question: 'How do CPU and GPU copies affect point-data transfers and completion time when WebGPU rebuilds its buffers?',
    reference: 'A rebuild that downloads existing positions to the CPU before uploading the expanded array.',
    acceptance: 'Measure bytes downloaded for existing positions. The GPU copy should preserve those records with zero position bytes downloaded.',
    coverage: 'One chain grows from 2,048 to 8,192 points. The recorded study also checked point data and subsequent frames on three graph types.',
    limits: 'Completion measures the full rebuild. The paths use different bounds setup, and the CPU copy runs first.',
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

// Frozen shared contract used in the existing point-styling JSON export format.
export const pointStylingExportContract: ValidationContract = {
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
}

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
