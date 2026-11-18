import { validationContracts } from '../runtime/validation'
import type { ResearchSummary } from './research'

// Editorial summaries of existing documents, not verdicts inferred from a run.
// Empty investigations mean no recorded measurement matrix is published here.
export function additionalResearch (reviewed: string): Record<string, ResearchSummary> {
  const entry = (id: string, details: Omit<ResearchSummary, 'question' | 'reviewed' | 'scope' | 'reproduce'> &
    Partial<Pick<ResearchSummary, 'scope' | 'reproduce' | 'reviewed'>>): ResearchSummary => ({
    question: validationContracts[id].question,
    reviewed,
    scope: validationContracts[id].coverage,
    reproduce: 'Select the documented input above, then inspect the named checks and unchecked scope. How it works defines the comparison contract.',
    ...details,
    variant: details.variant.replace(/\.$/, ''),
  })
  /* eslint-disable @typescript-eslint/naming-convention -- Keys match experiment routes. */
  return {
    'center-mass': entry('center-mass', {
      conclusion: 'Both reductions produced centers close to the CPU sum in the recorded 8,192-point smoke run; no production accuracy budget is agreed.',
      variant: 'Additive WebGL blend and two-stage WebGPU reduction; luma 10.0.0-alpha.4. Historical GPU identity was not recorded.',
      comparison: 'Shared moving positions → WebGL blend / WebGPU reduction → compare with the CPU sum',
      milestone: 'execution',
      method: 'overview',
      evidence: 'results',
      methodPages: ['algorithm', 'implementation', 'correctness', 'performance', 'limitations', 'references'],
      next: 'Agree a center-accuracy budget and validate the reduction when composed with the center force.',
      reproduce: 'Step or Play the same 8,192 moving points above. Read absolute CPU error and ' +
        'backend delta; elapsed time includes readback and drawing.',
      investigations: [{
        page: 'results',
        state: 'Current evidence',
        description: 'Initial correctness smoke run with explicitly incomplete environment metadata.',
      }],
    }),
    'scalable-reduction': entry('scalable-reduction', {
      conclusion: 'The recorded exploratory run reached ten million GPU-resident points; CPU reference coverage and the drawn preview remain capped.',
      variant: 'Hierarchical WebGPU reduction; luma 10.0.0-alpha.4. Historical GPU identity was not recorded.',
      comparison: 'GPU-generated positions → reduction hierarchy → optional center readback and capped preview',
      milestone: 'execution',
      method: 'overview',
      evidence: 'results',
      methodPages: ['algorithm', 'implementation', 'performance', 'limitations'],
      next: 'Agree accuracy and resource budgets; validate larger reductions inside an accepted simulation workload.',
      reproduce: 'Select a point count above. Step with readback to inspect the center; unsampled resident ticks remain unchecked.',
      investigations: [{
        page: 'results',
        state: 'Current evidence',
        description: 'Four exploratory count presets, center observations and bounded reduction timings.',
      }],
    }),
    'spatial-grid': entry('spatial-grid', {
      conclusion: 'The experiment can check grid counts, offsets and point membership exhaustively. It has no published native measurement matrix yet.',
      variant: 'WebGPU count, scan and scatter through luma APIs; structural CPU reference.',
      comparison: 'Shared positions → GPU grid build → independent CPU histogram, offsets and membership checks',
      milestone: 'simulation',
      method: 'overview',
      methodPages: ['algorithm', 'buffers', 'validation', 'performance'],
      next: 'Record a bounded native grid matrix, then judge the force that consumes it separately.',
      reproduce: 'Choose point count, distribution and grid size above; build and validate before interpreting timing.',
      investigations: [],
    }),
    'point-rendering': entry('point-rendering', {
      conclusion: 'WebGL point sprites and WebGPU quads can be viewed with matched circle inputs. This demo has no pixel-parity or picking gate.',
      variant: 'WebGL sprites and instanced WebGPU quads through luma; visual comparison only.',
      comparison: 'Shared positions, colors and diameter → WebGL sprites / WebGPU quads → visual inspection',
      milestone: 'rendering',
      method: 'overview',
      methodPages: ['implementation', 'limitations'],
      next: 'Use the production styling/picking experiment for image-based checks; validate the remaining rendering features.',
      reproduce: 'Change count and circle diameter above. For rendered-pixel and ID checks, continue to Point styling and picking.',
      investigations: [],
    }),
    'neighborhood-forces': entry('neighborhood-forces', {
      conclusion: 'Compensated sums and the cutoff correction fix the documented dense failures. Chunked ' +
        'traversal helps selected dense cases, with small-case costs.',
      variant: 'Fixed-radius WebGPU all-pairs/grid comparison; baseline and chunked loops; native Apple / Metal 3 evidence.',
      comparison: 'Shared positions → WebGPU all-pairs / spatial grid → independent CPU force checks',
      milestone: 'simulation',
      method: 'overview',
      evidence: 'precision-cost',
      methodPages: ['algorithm', 'validation', 'performance', 'sweep', 'research'],
      next: 'Validate broader density/radius envelopes and devices before choosing a traversal policy; global repulsion is separate.',
      reproduce: 'Use the live view for a local comparison. Diagnostics contains dense precision, paired precision cost and the repeatable parameter sweep.',
      investigations: [
        {
          page: 'precision-cost',
          state: 'Current evidence',
          description: 'Corrected baseline versus chunked traversal, with unchanged tolerance and paired GPU ' +
          'timing.',
        },
        { page: 'precision', state: 'Supporting investigation', description: 'Long force sums and the one-ULP cutoff correction behind the dense fix.' },
        {
          page: 'batched-results',
          state: 'Historical baseline',
          description: 'Original serial-kernel sweep; its dense failures and timings precede the precision ' +
          'fix.',
          replacement: 'precision-cost',
        },
        {
          page: 'results',
          state: 'Historical baseline',
          description: 'Initial neighborhood implementation and its original measurement scope.',
          replacement: 'precision',
        },
      ],
    }),
    'many-body': entry('many-body', {
      conclusion: 'The bounded exact all-pairs study compares production GLSL, direct/tiled WebGPU and ' +
        'CPU; its isolated timing results do not establish full-layout FPS.',
      variant: 'Production all-pairs GLSL and luma WebGPU loops; recorded Apple M3 / Chromium evidence.',
      comparison: 'Shared initial fixture → production WebGL / direct or tiled WebGPU / CPU → local checks and drift',
      milestone: 'simulation',
      method: 'overview',
      evidence: 'results',
      methodPages: ['research'],
      next: 'Keep this exact control while judging hierarchical approximation, composed forces and broader device coverage.',
      reproduce: 'Choose direct or tiled WebGPU and shared-input or independent evolution above. Use the separate timing sweep for accepted frozen workloads.',
      investigations: [
        { page: 'results', state: 'Current evidence', description: 'Exact repulsion observations and explicit correctness limits.' },
        { page: 'timing', state: 'Supporting investigation', description: 'Batched native M3 timing sweeps with checks outside the measured interval.' },
      ],
    }),
    'many-body-grid': entry('many-body-grid', {
      conclusion: 'Refined, stored far-field contributions pass the documented dense CPU checks. The inline baseline retains its strict-reference failures.',
      variant: 'Production hierarchical GLSL and luma WebGPU variants; bounded Apple M3 evidence.',
      comparison: 'Shared positions and sampling policy → hierarchy and force variants → CPU compatibility and separate approximation error',
      milestone: 'simulation',
      method: 'overview',
      evidence: 'far-field',
      next: 'Judge independent trajectories and precision cost before promoting a candidate; port parity is separate from approximation quality.',
      reproduce: 'Use the clustered 8,192/16,384-point, eight-sample precise cases. Compare ' +
        'centroid/far-field variants in Diagnostics; retain the failing inline control.',
      investigations: [
        {
          page: 'far-field',
          state: 'Current evidence',
          description: 'Refined and stored contributions close the checked dense force mismatches at the ' +
          'original budget.',
        },
        { page: 'precision-cost', state: 'Supporting investigation', description: 'Stored versus streamed contribution cost on matched frozen inputs.' },
        {
          page: 'centroids',
          state: 'Supporting investigation',
          description: 'Separate centroid and targeted division controls; their remaining failures stay ' +
          'visible.',
        },
        { page: 'precision', state: 'Supporting investigation', description: 'Hierarchy-level isolation of the original cumulative far-field discrepancy.' },
        {
          page: 'results',
          state: 'Historical baseline',
          description: 'Initial hierarchical port evidence, including its dense strict-CPU mismatch.',
          replacement: 'far-field',
        },
      ],
    }),
    'weighted-links': entry('weighted-links', {
      conclusion: 'The experiment checks ordered weighted springs against independent CPU edge lists. ' +
        'The large WebGL-star context-loss investigation remains parked.',
      variant: 'Production directional GLSL and luma WebGPU CSR traversal; dedicated original spring budget.',
      comparison: 'Shared graph and weights → ordered incoming/outgoing spring passes → independent CPU substep checks',
      milestone: 'simulation',
      method: 'overview',
      evidence: 'results',
      methodPages: ['implementation'],
      next: 'Extend accepted topology/device coverage and validate springs in the full runtime; keep the parked reset investigation separate.',
      reproduce: 'Select a graph and count above, then Step or Play and validate. Stage timing and isolated pass tools remain in Diagnostics.',
      investigations: [
        { page: 'results', state: 'Current evidence', description: 'Directional CPU reference, edge semantics and bounded native correctness findings.' },
        {
          page: 'performance',
          state: 'Supporting investigation',
          description: 'CSR and spring timings with explicit count/topology and WebGL availability limits.',
        },
        { page: 'context-loss', state: 'Parked', description: '100k-star reset investigation; temporary production debug controls have been removed.' },
      ],
    }),
    'repulsion-trajectories': entry('repulsion-trajectories', {
      conclusion: 'Independent evolution exposes accumulated drift even when local checks pass. The recorded study keeps drift and local failures separate.',
      variant: 'Hierarchical WebGL/WebGPU and independent CPU trajectories; stored/streamed precision controls on M3.',
      comparison: 'One initial fixture → independently evolving WebGL / WebGPU / CPU → local checks and accumulated drift',
      milestone: 'simulation',
      method: 'validation-contract',
      evidence: 'findings',
      next: 'Judge cooling and composed forces explicitly; repulsion-only expansion cannot establish convergence or graph quality.',
      reproduce: 'Select fixture, count, sample budget and quality above. Step or run 20 ticks, then compare local checks and descriptive drift.',
      investigations: [{
        page: 'findings',
        state: 'Current evidence',
        description: 'Independent repulsion trajectories and their bounded local-error/drift observations.',
      }],
    }),
    'pilot-viewer': entry('pilot-viewer', {
      conclusion: 'The M3 explorer works, but a wider run records a 100.4-ms running pick and fails responsiveness. ' +
        'A four-block narrower follow-up passes without reproducing the stall; its cause remains unknown. Production colors remain rejected.',
      reviewed: '2026-11-18',
      variant: 'Existing corrected luma WebGPU runtime with a bounded Karate Club explorer',
      comparison: 'Explore the real graph → verify identity and updates → measure complete frames and feedback',
      milestone: 'integration',
      method: 'scope',
      methodPages: ['agent-recipe'],
      evidence: 'findings',
      next: 'Run one declared normal/traced/traced/normal control near the historical wider canvas size. ' +
        'The narrower follow-up did not reproduce the stall or establish a fix. Keep the 50-ms gate unchanged.',
      investigations: [{ page: 'findings', state: 'Current evidence', description: 'Bounded pilot behavior, independent of strict production compatibility.' }],
    }),
    'viewer-comparison': entry('viewer-comparison', {
      conclusion: 'Small M3 viewers pass frame, update and running-picking checks; layouts look similar after Fit. ' +
        'Same-geometry interior colors still differ, so strict compatibility is rejected.',
      reviewed: '2026-11-18',
      variant: 'Unchanged production Graph / luma v9 versus integrated corrected luma v10 core',
      comparison: 'Same topology and supplied styles → independent layouts and running interaction → bounded workflow checks',
      milestone: 'integration',
      method: 'method',
      evidence: 'findings',
      methodPages: ['agent-recipe'],
      next: 'Follow the bounded pilot viewer and its reopened responsiveness investigation; retain these production color failures.',
      reproduce: 'The live viewers show a new local run. The agent recipe specifies a focused same-geometry paint comparison.',
      investigations: [{ page: 'findings', state: 'Current evidence', description: 'Separate measured workflow behavior from full migration approval.' }],
    }),
    'integrated-webgpu': entry('integrated-webgpu', {
      conclusion: 'Cooled Karate Club is readable after Fit: all 34 points are visible and pickable. Frames and sampled pixels pass; ' +
        'a 102-pick replay peaks at 17.5 ms. The earlier 68.2-ms failure is unexplained, not fixed. Large-star performance remains outside the accepted scope.',
      reviewed: '2026-11-18',
      variant: 'luma WebGPU resident core with corrected arithmetic; bounded circle and straight-link renderer',
      comparison: 'Resident simulation → shared positions → rendering and interaction → complete frame and feedback checks',
      milestone: 'integration',
      method: 'method',
      evidence: 'findings',
      next: 'Follow the pilot viewer: the practical trial has reproduced a running-pick stall with request phases recorded.',
      reproduce: 'Use Assess settled Karate Club and Export JSON. Replay cooled picking accepts that capture ' +
        'or the current session’s assessment; keep the native tab visible.',
      investigations: [{ page: 'findings', state: 'Current evidence', description: 'Separate strict compatibility, practical usability and full readiness.' }],
    }),
    'resident-layout': entry('resident-layout', {
      conclusion: 'Resident execution and edits are demonstrated in isolation. ' +
        'The integrated pilot has bounded timing passes; large-star and intermittent latency failures remain open.',
      reviewed: '2026-11-17',
      variant: 'Two luma WebGPU execution paths using the same force kernels; recorded Apple M3 / Chrome evidence.',
      comparison: 'Same graph and kernels → staged CPU-bounds / GPU-resident execution → checkpoint bits, edits and frame timing',
      milestone: 'integration',
      method: 'validation-contract',
      evidence: 'timing-updates',
      next: 'Follow the integrated pilot for shared-position rendering, interaction and complete-frame M3 timing; retain these isolated resident controls.',
      reproduce: 'Step and check the selected graph, apply a point/link edit, and continue. Use Time resident frames for separately validated timing batches.',
      investigations: [
        {
          page: 'timing-updates',
          state: 'Current evidence',
          description: 'Resident frame timing, instrument controls and state-preserving point/link updates.',
        },
        {
          page: 'dataflow',
          state: 'Supporting investigation',
          description: 'Execution dataflow and checkpoint equivalence against the staged WebGPU control.',
        },
      ],
    }),
    'performance-lab': entry('performance-lab', {
      conclusion: 'This benchmark separates CPU submission from synchronized completion for isolated ' +
        'drawing and reduction. It has no published cross-device measurement matrix.',
      variant: 'Matched luma WebGL/WebGPU microbenchmarks; live measurements and local JSON export.',
      comparison: 'Matched isolated workload → warmups and repeated samples → submit/completion distributions',
      milestone: 'production',
      method: 'methodology',
      methodPages: ['interpretation'],
      next: 'Measure accepted complete-engine workloads under agreed latency and quality budgets; isolated completion time is not Graph FPS.',
      reproduce: 'Choose rendering or simulation, count and sample preset above. Stop cancels ' +
        'acceptance of an incomplete batch; export completed local measurements.',
      investigations: [],
    }),
    'precision-diagnostics': entry('precision-diagnostics', {
      conclusion: 'The diagnostic separates mathematical accuracy from legacy arithmetic compatibility. ' +
        'It does not select a new accuracy threshold or production formula.',
      variant: 'Analytic CPU references, production GLSL gravity and diagnostic WGSL force/sum kernels.',
      comparison: 'Frozen numeric corpus → analytic / float32 / GLSL / WGSL paths → accuracy and compatibility separately',
      milestone: 'simulation',
      method: 'method',
      evidence: 'method',
      methodPages: ['agent-recipe'],
      next: 'Agree the intended mathematical contract and accuracy budget before choosing a production arithmetic policy.',
      reproduce: 'Choose a corpus and seed in the live experiment. The agent recipe records one focused cancellation replay.',
      investigations: [{
        page: 'method',
        state: 'Current evidence',
        description: 'The 12 November M3 observations are recorded separately from a new local run.',
      }],
    }),
    'point-capacity': entry('point-capacity', {
      conclusion: 'The recorded resize cycles preserve checked state and show lower in-capacity update ' +
        'cost with retained storage; faster steady-state frames are not established.',
      variant: 'GPU rebuild versus retained-capacity luma WebGPU lanes; historical CPU-copy control; Apple M3 / Chrome 156.',
      comparison: 'Same resident graph → grow/shrink/regrow → retained records, next-frame checks and tracked buffer cost',
      milestone: 'execution',
      method: 'validation-contract',
      evidence: 'reuse',
      next: 'Validate public setters, transitions, borrowed-device ownership and recovery; tracked buffers are not total VRAM.',
      reproduce: 'Compare GPU rebuild with retained capacity, keep CPU checking enabled, apply pin/absence edits, then run the documented resize cycles.',
      investigations: [
        { page: 'reuse', state: 'Current evidence', description: 'Paired GPU-bound resize cycles, retained capacity and explicit first-growth/update limits.' },
        {
          page: 'findings',
          state: 'Historical baseline',
          description: 'Exact-size rebuild versus CPU-copy transfer control; not the same cost comparison.',
          replacement: 'reuse',
        },
      ],
    }),
    'gpu-stage-profile': entry('gpu-stage-profile', {
      conclusion: 'Controlled profiling identifies hub springs and aggregation as major costs in the ' +
        'recorded cases. Split-pass sums are not normal-frame latency.',
      variant: 'Frozen rebuilt/retained WebGPU controls; native Apple M3 / Chrome 156.',
      comparison: 'Frozen checked input → normal frames / split-pass diagnostics → replay gates and separate timing populations',
      milestone: 'production',
      method: 'validation-contract',
      evidence: 'method',
      next: 'Measure order-preserving optimizations in normal frames and keep instrumentation overhead separate.',
      reproduce: 'Select graph, count and input history above, then prepare/profile. Inspect normal-frame and diagnostic tables as different workloads.',
      investigations: [{
        page: 'method',
        state: 'Current evidence',
        description: 'Frozen-input protocol, instrumentation validation and stage findings on M3.',
      }],
    }),
    'hub-springs': entry('hub-springs', {
      conclusion: 'Cooperative prefetch preserves the recorded ordered spring gates and helps large ' +
        'hubs. Low-degree benefit and the activation threshold remain workload-dependent.',
      variant: 'Plain versus cooperative luma WebGPU spring kernels; bounded 8,192-point broom fixtures on M3.',
      comparison: 'Same ordered neighbors → plain / cooperative kernels → trajectory gates and paired normal-frame cost',
      milestone: 'simulation',
      method: 'validation-contract',
      evidence: 'acceptance',
      next: 'Validate broader multi-hub graphs and devices before choosing a production threshold.',
      reproduce: 'Compare a selected degree/pin state, then use the degree, threshold and trajectory ' +
        'diagnostics. Read normal-frame costs separately from profiles.',
      investigations: [
        {
          page: 'acceptance',
          state: 'Current evidence',
          description: 'Evolving trajectories, threshold crossover and normal-frame controls at the original ' +
          'spring budget.',
        },
        {
          page: 'findings',
          state: 'Historical baseline',
          description: 'First threshold-64 study with different readback/fallback conditions.',
          replacement: 'acceptance',
        },
      ],
    }),
    'cell-aggregation': entry('cell-aggregation', {
      conclusion: 'Cached membership with bounded sorting preserves the checked ordered sums; its ' +
        'normal-frame benefit depends on occupancy and the chosen candidate.',
      variant: 'Source-index-ordered baseline and cached-grid luma WebGPU kernels; recorded M3 reference settings.',
      comparison: 'Same checked input and sum order → baseline / cached aggregation → exact structures and normal-frame cost',
      milestone: 'simulation',
      method: 'validation-contract',
      evidence: 'findings',
      next: 'Judge production routing, sampling and varied springs separately from these fixed reference settings.',
      investigations: [{
        page: 'findings',
        state: 'Current evidence',
        description: 'Membership caching, bounded sorting, rejected cache-only controls and accepted ' +
        'ordered comparisons.',
      }],
    }),
    'layout-acceptance': entry('layout-acceptance', {
      conclusion: 'Selected production-style sampling, varied springs and long-run controls pass the ' +
        'recorded original gates. They do not establish complete production acceptance.',
      variant: 'Strict baseline versus hub-prefetch/cached-grid WebGPU candidate; bounded M3 production-setting matrix.',
      comparison: 'Selected production settings → evolving baseline / candidate → checkpoint gates, probes and normal-frame cost',
      milestone: 'simulation',
      method: 'validation-contract',
      evidence: 'production',
      next: 'Broaden force coverage, graphs and devices, then agree quality/runtime budgets before integrating the complete engine.',
      reproduce: 'Use the preset ladder, adaptive sampling and documented input history above. ' +
        'Validate the full-strength probe and keep intermediate unchecked ticks explicit.',
      investigations: [
        { page: 'production', state: 'Current evidence', description: '32-sample/varied-spring controls, adaptive sampling and selected 5,000-tick runs.' },
        {
          page: 'findings',
          state: 'Historical baseline',
          description: 'Earlier fixed-setting matrix with eight near-field samples.',
          replacement: 'production',
        },
      ],
    }),
  }
  /* eslint-enable @typescript-eslint/naming-convention */
}
