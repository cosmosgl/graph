import { additionalResearch } from './research-catalog'

export type EvidenceState = 'Current evidence' | 'Supporting investigation' | 'Historical baseline' | 'Superseded' | 'Parked'
export type Investigation = { page: string; state: EvidenceState; description: string; replacement?: string }
export type MethodAssessment = { title: string; verdict: 'Method under test' | 'Reference control' | 'Rejected under current gates';
  detail: string; page: string; section?: string; }
export type ResearchSummary = {
  question: string; conclusion: string; scope: string; variant: string; reviewed: string;
  milestone: 'execution' | 'simulation' | 'rendering' | 'integration' | 'production';
  evidence?: string; next: string; reproduce: string; comparison: string;
  methods?: MethodAssessment[]; method: string; methodPages?: string[]; investigations: Investigation[];
}
const BASELINE_REVIEWED = '2026-11-12'

export function researchMethodPages (record: ResearchSummary): string[] {
  return [...new Set([record.method, ...record.methodPages ?? [], 'validation-contract'])]
}
// Editorial assessments, never inferred from a test count. Home highlights and
// experiment pages read these same records; exact measurements stay linked.
/* eslint-disable @typescript-eslint/naming-convention -- Keys match public experiment routes. */
export const research: Record<string, ResearchSummary> = {
  ...additionalResearch(BASELINE_REVIEWED),
  'smoothstep-coverage': {
    method: 'method',
    evidence: 'findings',
    milestone: 'rendering',
    reviewed: '2026-11-17',
    comparison: 'Same input → original and ascending-edge coverage on WebGL and WebGPU → actual line pixels and IDs',
    question: 'Can changing how we calculate a line edge make WebGL and WebGPU draw the same pixels?',
    conclusion: 'On M3, the hard line still differs at 180 pixels. The same saved corners reproduce the different positions in both renderers.',
    scope: 'Three fixed inputs, two line draws and a matched-corner position trace with 17 lengths on M3; other settings remain available locally.',
    variant: 'Original production expression and an ascending-edge diagnostic on both backends',
    next: 'The focused study is closed. Reopen for a practical coverage change or exact cross-device parity; broader straight-link research remains parked.',
    reproduce: 'Open the experiment and select Run comparison; export the measured values and device details.',
    investigations: [{
      page: 'findings',
      state: 'Current evidence',
      description: 'Focused M3 study closed with its evidence; no production replacement is approved.',
    }],
  },
  'ribbon-generation': {
    question: 'Can WebGPU share curve generation across ribbon sides and passes at a lower total cost?',
    conclusion: 'Stopped without adoption: rebuilding cost more, static reuse was inconsistent, and coarse curves changed color pixels.',
    scope: 'Same-device color/ID preservation and GPU plus completion cost on frozen curves.',
    variant: 'Vertex baseline, duplicate baseline, compute rebuild and static sample reuse; luma 10.0.0-alpha.15',
    reviewed: '2026-11-16',
    milestone: 'rendering',
    method: 'method',
    evidence: 'findings',
    investigations: [{ page: 'findings', state: 'Parked', description: 'Investigation stopped; native measurements and the coarse-curve color failure are retained for reference.' }],
    comparison: 'Resident endpoints → vertex generation / compute sample cache → identical raster and coverage paths',
    next: 'No further work planned. Keep the current vertex renderer.',
    reproduce: 'This page is a retained research record. Recorded findings describe the original conditions and optional command-line reproduction.',
  },
  collision: {
    comparison: 'Shared initial graph → exact collision or hashed neighbor slots → slot, force and position checks',
    question: 'Can WebGPU reproduce Cosmos collision both below and above the 4,096-point cutoff?',
    conclusion: 'The hashed candidate matches WebGL slot IDs and passes the numeric checks at 4,097 and 8,192 points. ' +
      'Two resident passes add 2.03 ms median in the frozen 8,192-point GPU tick.',
    scope: 'Nine hashed passes compare all slots, forces and positions. The in-tick replay covers the frozen and moving 8,192-point communities on M3.',
    variant: 'Targeted exact collision and a separate f32 hash/slot implementation; luma 10.0.0-alpha.15 in the large study',
    reviewed: '2026-11-19',
    milestone: 'simulation',
    evidence: 'hashed-findings',
    method: 'method',
    methodPages: ['hashed-method'],
    next: 'Measure throughput and layout quality above 8,192 points with dense graphs and the production seed schedule.',
    reproduce: 'Use the hash and slot method to replay both sizes. Choose Composed with collision in the integrated viewer to try it in a moving graph.',
    investigations: [
      {
        page: 'hashed-findings',
        state: 'Current evidence',
        description: 'Production GLSL slot comparison, normal-tick integration and paired GPU cost on M3.',
      },
      { page: 'precision', state: 'Supporting investigation', description: 'Targeted correction, repeated independent matrix, ablations and paired GPU cost.' },
      {
        page: 'findings',
        state: 'Supporting investigation',
        description: 'The corrected center sum and dense four-pass composition. This closes the earlier center-stage discrepancy.',
      },
      {
        page: 'trajectories',
        state: 'Historical baseline',
        description: 'Original native collision arithmetic and its independent drift/failing cooled star. These failures still apply to that variant.',
        replacement: 'precision',
      },
    ],
  },
  'combined-layout': {
    comparison: 'Shared initial graph → independently evolving WebGL / WebGPU / CPU → stage and whole-tick checks',
    question: 'How do the additional forces behave in a resident tick in production order?',
    conclusion: 'Both community layouts pass the 40-tick one-pixel screen on M3. The integrated replay corrects the original pointer drift.',
    scope: 'Two communities workloads at 256 and 8,192 points, same-input replays, projected motion and frozen GPU cost with basic drawing.',
    variant: 'Corrected resident core with mouse, cluster and per-point attraction stages; luma 10.0.0-alpha.15',
    reviewed: '2026-11-19',
    milestone: 'simulation',
    evidence: 'force-composition',
    method: 'method',
    next: 'Extend the corrected force set to large representative graphs and measure full viewer cost.',
    reproduce: 'Run the opt-in force composition study for the trajectory and frozen cost. The live control shows the resident core.',
    investigations: [
      {
        page: 'gravity-trig',
        state: 'Supporting investigation',
        description: 'Refined gravity closes the communities whole-tick discrepancy; includes the final 8,192-point matrix and bounded cost.',
      },
      {
        page: 'force-composition',
        state: 'Current evidence',
        description: 'Resident production-order comparison, first failed ticks with stage replays, and cost with basic drawing.',
      },
      {
        page: 'tick-rounding',
        state: 'Supporting investigation',
        description: 'Repulsion integration alignment that precedes the gravity correction; its remaining failure is retained.',
        replacement: 'gravity-trig',
      },
      {
        page: 'spring-products',
        state: 'Supporting investigation',
        description: 'Contribution-rounding ablations and the targeted spring candidate; not complete composed-tick acceptance.',
      },
      { page: 'spring-cost', state: 'Supporting investigation', description: 'Frozen spring arithmetic timings and their acceptance boundaries.' },
      {
        page: 'spring-precision',
        state: 'Historical baseline',
        description: 'Early distance/strict arithmetic investigation and its then-current failure.',
        replacement: 'gravity-trig',
      },
      {
        page: 'scaling',
        state: 'Historical baseline',
        description: 'Initial 8,192-point scaling matrix, including the failures later isolated and corrected.',
        replacement: 'gravity-trig',
      },
      {
        page: 'checkpoints',
        state: 'Supporting investigation',
        description: 'Checkpoint validation and deterministic failure replay on 512/2,048-point graphs.',
      },
      {
        page: 'findings',
        state: 'Historical baseline',
        description: 'Initial small-graph composition and convergence study; useful method/history, not the final candidate result.',
        replacement: 'gravity-trig',
      },
    ],
  },
  'matched-layout': {
    method: 'method',
    comparison: 'Shared graph and sampling tape → independently evolving WebGL / WebGPU / CPU → compatibility and descriptive quality',
    question: 'Do production GLSL, WebGPU and CPU retain comparable layout behavior under matched inputs?',
    conclusion: 'The center-off strict WebGPU comparison records zero measured pointwise drift across 11,200 independently evolving M3 ticks.',
    scope: '12 selected runs; shared CPU sampling decisions. Center-on historical runs and full runtime adaptation remain separate.',
    variant: 'Strict WebGPU, center off; luma 10.0.0-alpha.4; Apple M3',
    reviewed: BASELINE_REVIEWED,
    milestone: 'simulation',
    evidence: 'findings',
    next: 'Validate independent runtime scheduling and agree quality budgets across representative data and devices.',
    reproduce: 'Use the matched comparison method and findings for the exact center-off fixture/preset matrix.',
    investigations: [
      { page: 'findings', state: 'Current evidence', description: 'Center-off production-style trajectories and their bounded quality/drift measurements.' },
      { page: 'center', state: 'Supporting investigation', description: 'Optional center attraction, aggregate checks and paired added GPU cost.' },
    ],
  },
  'curved-links': {
    method: 'validation-contract',
    evidence: 'method',
    milestone: 'rendering',
    reviewed: '2026-11-17',
    comparison: 'Compare production curved ribbons across WebGL and WebGPU against independent triangle-strip masks and source checks.',
    question: 'Do production solid curves render and pick consistently through public luma APIs?',
    conclusion: 'M3 dash/dot curves preserve original colors and source visibility, but only the 4/24 zero-opacity rows pass all gates.',
    scope: 'Earlier M3 / Chromium 157 geometry matrix: 20/56 nonzero-opacity plus 8/8 zero-opacity rows pass; all 64 preserve color and source visibility. ' +
      'The alpha.15 gradient matrix preserves colors and source visibility in all 64 cases; the separate faint-alpha replay passes 72/72.',
    variant: 'Unmodified GLSL/color control; color-face/source-byte IDs; previous two-sided IDs retained. ' +
      'Luma alpha.15 patterns/gradients and matched solid controls; older geometry uses alpha.4.',
    next: 'Further curve/pattern investigation is parked for the first migration. Reopen when these features enter scope or practical defects appear.',
    reproduce: 'Compare all three picking policies, run the 64-case sweep and default-bow pixel replay, then export JSON locally.',
    methods: [
      {
        title: 'Rational ribbon · color-face picking',
        verdict: 'Method under test',
        page: 'method',
        detail: 'Matches ID culling to color; native mask/color boundary failures still prevent complete acceptance.',
      },
      {
        title: 'Previous visible-width, two-sided IDs',
        verdict: 'Reference control',
        page: 'method',
        section: 'folded-ribbon-picking-investigation',
        detail: 'Retained unchanged; folded back faces can select invisible sources.',
      },
      {
        title: 'Explicit linear interpolation',
        verdict: 'Rejected under current gates',
        page: 'method',
        section: 'default-bow-boundary-investigation',
        detail: 'Identical-geometry replay retains the native bow cutoff disagreement.',
      },
    ],
    investigations: [{
      page: 'method',
      state: 'Parked',
      description: 'Further curve/pattern investigation is stopped for the first slice, not resolved. ' +
        'Retain all gates and revisit before full feature approval.',
    }],
  },
  'straight-links': {
    method: 'validation-contract',
    evidence: 'method',
    milestone: 'rendering',
    reviewed: '2026-11-17',
    comparison: 'Production straight ribbons → WebGL / WebGPU color and host IDs → independent scalar masks and source checks',
    question: 'Do straight links render and pick consistently through public luma APIs?',
    conclusion: 'M3 dash/dot links pass 14/24 cases with original colors intact; mask and color boundary failures keep the candidate rejected.',
    scope: 'Earlier M3 / Chromium 157 geometry matrix: 22/32 nonzero-opacity and 8/8 opacity-zero cases pass. ' +
      'The separate 72-case alpha replay retains four blended threshold-edge and four hard-edge failures; neither matrix is production approval.',
    variant: 'Production GLSL control and visible-footprint/source-byte IDs; original color. ' +
      'Luma alpha.15 patterns/gradients and matched solid controls; Apple M3.',
    next: 'Reuse solid straight links in the first slice; further exact-edge research is parked unless practical rendering or picking fails.',
    reproduce: 'Compare both picking rules, blending, zoom and DPR, then run the 40-case straight-link sweep and export JSON locally.',
    methods: [
      {
        title: 'Straight ribbon · source-byte picking',
        verdict: 'Method under test',
        page: 'method',
        detail: 'Preserves original color and source visibility; hard-edge and raster boundaries remain rejected.',
      },
      {
        title: 'Hard-only pixel-distance coverage',
        verdict: 'Rejected under current gates',
        page: 'method',
        section: 'hard-edge-coverage-investigation',
        detail: 'Removes selected WebGPU/CPU mask failures but changes original color pixels; retained as a diagnostic.',
      },
    ],
    investigations: [{
      page: 'method',
      state: 'Parked',
      description: 'Exact-boundary research is stopped for the first slice. Solid links remain an integration input; ' +
        'practical defects reopen the investigation.',
    }],
  },
  'point-styling': {
    method: 'validation-contract',
    comparison: 'Same styled points → production WebGL / WebGPU color and ID images → full-image and scalar-mask checks',
    question: 'Does point-ID picking select the shapes that Cosmos actually renders?',
    conclusion: 'Stored-alpha picking resolves the tested invisible-source boundary on M3 and SwiftShader without changing color bytes; ' +
      'region filtering reduces sparse-request cost while dense overlap remains expensive.',
    scope: 'Five original candidate/UI checks pass on both environments; software retains two old source-byte failures. ' +
      'All 16 paired filtered/prototype cases pass exact outputs on M3 and SwiftShader. ' +
      'Pixel-distance hover/focus overlays pass CPU colors in 96/96 cases on both; eight polygon-mask rows remain rejected. ' +
      'The stored-alpha reference consumes measured source masks, not a portable rounding prediction.',
    variant: 'Stored-alpha-v1 through public luma 10.0.0-alpha.15 APIs; Apple M3 and Linux x64 SwiftShader. Earlier polygon measurements retain alpha.4.',
    reviewed: '2026-11-16',
    milestone: 'rendering',
    evidence: 'method',
    methodPages: ['transition-method'],
    next: 'Integrate basic circles and point picking first. Advanced styles and exact-edge research are parked; ' +
      'practical visibility and latency remain required.',
    reproduce: 'Run Check stored-alpha picking in Diagnostics, then Compare filtered picking with this page visible. ' +
      'The fixed replay and bounded cost sweep preserve the live scene; historical polygon and source-byte controls stay selectable.',
    methods: [
      {
        title: 'Stored-alpha picking',
        verdict: 'Method under test',
        page: 'method',
        detail: 'Per-point stored paint gates geometric IDs without changing original colors. ' +
          'Filtered sparse requests improve; dense cost and runtime integration remain open.',
      },
      {
        title: 'Styled points · normalized coverage',
        verdict: 'Method under test',
        page: 'method',
        detail: 'Bounded shape/image/ring checks coexist with retained polygon and visibility counterexamples.',
      },
      {
        title: 'Pixel-space polygon predicates',
        verdict: 'Rejected under current gates',
        page: 'method',
        detail: 'CPU diamond ties and original-color preservation failures remain; matching GPU IDs is insufficient.',
      },
    ],
    investigations: [
      { page: 'method', state: 'Current evidence', description: 'Styling and picking matrix with retained visibility and coverage failures.' },
      { page: 'transition-findings', state: 'Supporting investigation', description: 'Exact point position, fill, size and exit checkpoints on M3.' },
    ],
  },
}

/* eslint-enable @typescript-eslint/naming-convention */

export const milestones = [
  {
    id: 'execution',
    title: 'GPU execution and resources',
    position: 'Resident resizing, host ownership and explicit restart tested on M3',
    acceptance: 'Host ownership, recovery and the production dependency',
    gates: ['Choose a shared luma package family for the complete engine and deck.gl.',
      'Verify full viewer recovery after unplanned device loss, including pending reads and interactions.'],
    evidence: [['resident-layout', 'Resident execution'], ['point-capacity', 'Point capacity'], ['integrated-webgpu', 'Host ownership']],
  },
  {
    id: 'simulation',
    title: 'Simulation',
    position: 'Corrected interactive forces match the CPU through 8,192 points. Four corners reaches 50 ms median on million-point dense communities',
    acceptance: 'Remaining forces, graph scalability and affordable precision',
    gates: ['Confirm composed layout quality across longer runs and more graph shapes, retaining the native pointer failures.',
      'Verify hashed collision above 8,192 points with the production scheduling and seed stream.',
      'Validate the supported force set in the million-point viewer and account for slow ticks on dense graphs and large hubs.'],
    evidence: [['mouse-repulsion', 'Mouse repulsion'], ['point-attractors', 'Per-point attractors'], ['cluster-attraction', 'Cluster study'],
      ['combined-layout', 'Combined forces'], ['integrated-webgpu', 'Interactive forces'],
      ['collision', 'Collision'], ['matched-layout', 'Matched layouts'], ['million-graph', 'Million-point Four corners']],
  },
  {
    id: 'rendering',
    title: 'Rendering and interaction',
    position: 'Reduced drawing preserves frozen pixels and meets the pick target in the million-point M3 replay',
    acceptance: 'Coverage discrepancies, remaining styles and pointer interaction',
    gates: ['Verify covered-point drawing and cached highlights with the supported production styles.',
      'Integrate circles and solid straight links first; defer advanced styles and review parked boundary failures before full readiness.',
      'Validate transitions, remaining styles and pointer behavior. Resolve the selection readback API before production integration.'],
    evidence: [['curved-links', 'Curved solid links'], ['straight-links', 'Straight-link rendering/picking'],
      ['point-styling', 'Point styling/picking'], ['point-rendering', 'Circle primitive'], ['million-graph', 'Scale interaction']],
  },
  {
    id: 'integration',
    title: 'Library and embedding',
    position: 'Wider DPR 1 and standalone DPR 2 replays pass on M3. Historical inline picks still exceed 50 ms',
    acceptance: 'Complete Graph and host contracts',
    gates: ['Attribute the representative viewer’s running-pick delay, retaining the unchanged 50-ms target and recorded phases.',
      'Keep the documented first-pilot scope bounded; production color compatibility and large-star performance remain rejected.',
      'Connect production setters, tracking and selection to asynchronous GPU reads. Verify deck integration on a shared dependency family.'],
    evidence: [['pilot-viewer', 'Representative pilot'], ['viewer-comparison', 'Production comparison'], ['point-capacity', 'Resident updates']],
  },
  {
    id: 'production',
    title: 'Production acceptance',
    position: 'Reduced drawing meets the M3 pick target in one replay. The million-point frame target and strict color compatibility remain open',
    acceptance: 'Agreed quality/performance budgets and native support matrix',
    gates: ['Agree representative workloads, quality, frame/update latency and peak-memory budgets.',
      'Verify intended native GPUs/browsers and unsupported-device behavior before switching production.'],
    evidence: [['gpu-stage-profile', 'Controlled profiling'], ['performance-lab', 'Isolated benchmarks']],
  },
] as const

export const mainOpenIssues = [
  { text: 'Complete production force/rendering coverage and the Graph/host contracts.', href: '#/feature-inventory' },
  {
    text: 'Meet the frame target at scale and verify production styles and graph updates.',
    href: '#/million-graph?section=doc-interactive-study',
  },
  { text: 'Agree quality, latency/memory budgets and the intended native GPU/browser matrix.', href: '#/roadmap?section=milestone-production' },
] as const

// Current editorial priority. The gate and findings come from the same records
// used by Roadmap and the experiment page, never from this browser's live run.
export const migrationFocus = {
  step: 4,
  experiment: 'viewer-comparison',
} as const
