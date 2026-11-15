import { additionalResearch } from './research-catalog'

export type EvidenceState = 'Current evidence' | 'Supporting investigation' | 'Historical baseline' | 'Superseded' | 'Parked'
export type Investigation = { page: string; state: EvidenceState; description: string; replacement?: string }
export type ResearchSummary = {
  question: string; conclusion: string; scope: string; variant: string; reviewed: string;
  milestone: 'execution' | 'simulation' | 'rendering' | 'integration' | 'production';
  evidence?: string; next: string; reproduce: string; comparison: string;
  method: string; methodPages?: string[]; investigations: Investigation[];
}
export const REVIEWED = '2026-11-12'

export function researchMethodPages (record: ResearchSummary): string[] {
  return [...new Set([record.method, ...record.methodPages ?? [], 'validation-contract'])]
}
// Editorial assessments, never inferred from a test count. Home highlights and
// experiment pages read these same records; exact measurements stay linked.
/* eslint-disable @typescript-eslint/naming-convention -- Keys match public experiment routes. */
export const research: Record<string, ResearchSummary> = {
  ...additionalResearch(REVIEWED),
  collision: {
    comparison: 'Shared initial graph → WebGL / WebGPU / CPU → shared-input or independent collision checks',
    question: 'Can WebGPU preserve collision behavior when composed with the other Cosmos forces?',
    conclusion: 'The targeted correction passes all 1,700 tick and 1,700 independent trajectory gates in the recorded M3 matrix.',
    scope: 'Selected isolated and combined fixtures through 512 points; zero measured pointwise drift. This is bounded compatibility evidence.',
    variant: 'Targeted collision distance + contributions; corrected high/low center; luma 10.0.0-alpha.4; M3 / Chromium 157',
    reviewed: REVIEWED,
    milestone: 'simulation',
    evidence: 'precision',
    method: 'method',
    next: 'Validate larger collision workloads, broader inputs/devices and the production precision/cost policy.',
    reproduce: 'Use Recorded control above: dense 512-point star, combined independent layouts, four collision passes, 300 ' +
      'cooling ticks, targeted arithmetic and high/low center.',
    investigations: [
      { page: 'precision', state: 'Current evidence', description: 'Targeted correction, repeated independent matrix, ablations and paired GPU cost.' },
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
    question: 'Do repulsion, ordered springs, gravity and cooling converge consistently when each backend evolves independently?',
    conclusion: 'The refined-gravity candidate passes the documented 8,192-point chain, communities and star checks at unchanged compatibility tolerances.',
    scope: 'Selected force settings, own-input checkpoints and full-strength probes. These runs do not include the newer ' +
      'collision workload or prove broad layout quality.',
    variant: 'Refined gravity + rounded steps (trig); luma 10.0.0-alpha.4; Apple M3',
    reviewed: REVIEWED,
    milestone: 'simulation',
    evidence: 'gravity-trig',
    method: 'method',
    next: 'Broaden remaining force coverage and quality/runtime acceptance; keep the corrected collision envelope separate.',
    reproduce: 'Use Recorded control above (8,192-point communities, refined gravity, 100 cooling ticks). The current evidence ' +
      'lists the larger 8,192-point matrix and exact measurement settings.',
    investigations: [
      {
        page: 'gravity-trig',
        state: 'Current evidence',
        description: 'Refined gravity closes the communities whole-tick discrepancy; includes the final 8,192-point matrix and bounded cost.',
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
    reviewed: REVIEWED,
    milestone: 'simulation',
    evidence: 'findings',
    next: 'Validate independent runtime scheduling and agree quality budgets across representative data and devices.',
    reproduce: 'Use the matched comparison method and findings for the exact center-off fixture/preset matrix.',
    investigations: [
      { page: 'findings', state: 'Current evidence', description: 'Center-off production-style trajectories and their bounded quality/drift measurements.' },
      { page: 'center', state: 'Supporting investigation', description: 'Optional center attraction, aggregate checks and paired added GPU cost.' },
    ],
  },
  'straight-links': {
    method: 'validation-contract',
    evidence: 'method',
    milestone: 'rendering',
    reviewed: '2026-11-15',
    comparison: 'Production straight ribbons → WebGL / WebGPU color and host IDs → independent scalar masks and source checks',
    question: 'Do straight links render and pick consistently through public luma APIs?',
    conclusion: 'Straight links remain 30/40; cap rasterization and body-coverage failures are isolated and retained as blockers.',
    scope: 'Apple M3, inline Chromium 157: 22/32 nonzero-opacity and 8/8 opacity-zero cases pass. ' +
      'All 40 preserve original color bytes and have zero invisible source picks; ten hard/raster boundary cases remain rejected.',
    variant: 'Production GLSL control and visible-footprint/source-byte ID candidate; original color; luma 10.0.0-alpha.4; Apple M3',
    next: 'Retain the boundary blockers and validate curved solid links next; common cap geometry remains a separate candidate with unchanged gates.',
    reproduce: 'Compare both picking rules, blending, zoom and DPR, then run the 40-case straight-link sweep and export JSON locally.',
    investigations: [{
      page: 'method',
      state: 'Current evidence',
      description: 'Straight-ribbon comparisons, hard-edge probes and a 48-row cap/raster investigation with unchanged gates.',
    }],
  },
  'point-styling': {
    method: 'validation-contract',
    comparison: 'Same styled points → production WebGL / WebGPU color and ID images → full-image and scalar-mask checks',
    question: 'Does point-ID picking select the shapes that Cosmos actually renders?',
    conclusion: 'Polygon failures are isolated; CPU boundary and color-preservation gates keep the pixel-space diagnostic rejected.',
    scope: 'Apple M3: normalized control 88/96; pixel-space diagnostic 86/96. The diagnostic has exact GPU IDs, ' +
      'eight native CPU diamond-tie rows and two ratio-2 color-preservation rejections. Original gates and controls remain in force.',
    variant: 'Opt-in pixel-space polygons beside retained normalized source-byte control; luma 10.0.0-alpha.4; Apple M3',
    reviewed: '2026-11-15',
    milestone: 'rendering',
    evidence: 'method',
    next: 'Validate production link rendering and picking; retain the polygon counterexamples for a separate reference/preservation decision.',
    reproduce: 'Select Point rings and greyout and compare Normalized with Pixel-space arithmetic. ' +
      'Read every rejected pixel in Polygon boundary replay and run the 96-row sweep under each mode. CPU and color-preservation failures stay rejected.',
    investigations: [{
      page: 'method',
      state: 'Current evidence',
      description: 'Styling/picking method, bounded native matrix and rejected visibility/coverage ' +
      'controls.',
    }],
  },
}

/* eslint-enable @typescript-eslint/naming-convention */

export const milestones = [
  {
    id: 'execution',
    title: 'GPU execution and resources',
    position: 'Resident execution and bounded resizing demonstrated',
    acceptance: 'Host ownership, recovery and the production dependency',
    gates: ['Choose a pinned luma package family for the complete engine.', 'Verify borrowed resource ownership, cleanup and recovery after device loss.'],
    evidence: [['resident-layout', 'Resident execution'], ['point-capacity', 'Point capacity']],
  },
  {
    id: 'simulation',
    title: 'Simulation',
    position: 'Selected composed-force cases through 8,192 points; collision through 512',
    acceptance: 'Remaining forces, graph scalability and affordable precision',
    gates: ['Validate per-point attractors, clusters and mouse repulsion, then compose them in production force order.',
      'Validate the larger collision route and representative graph families at unchanged declared gates.',
      'Agree independent layout-quality and runtime sampling contracts; measure accepted precision cost.'],
    evidence: [['combined-layout', 'Combined forces'], ['collision', 'Collision'], ['matched-layout', 'Matched layouts']],
  },
  {
    id: 'rendering',
    title: 'Rendering and interaction',
    position: 'Bounded point styles/images, 88/96 ring cases and 30/40 straight-link cases demonstrated on M3',
    acceptance: 'Coverage discrepancies, remaining styles and pointer interaction',
    gates: ['Retain straight-link boundary blockers while validating curved ribbons, patterns, arrows and link states.',
      'Retain polygon CPU/preservation gates; validate transitions and pointer behavior, measure accepted rendering cost and broaden native devices.'],
    evidence: [['straight-links', 'Straight-link rendering/picking'], ['point-styling', 'Point styling/picking'], ['point-rendering', 'Circle primitive']],
  },
  {
    id: 'integration',
    title: 'Library and embedding',
    position: 'Supporting resource-transfer mechanisms demonstrated',
    acceptance: 'Complete Graph and host contracts',
    gates: ['Exercise a small GraphSimulation/Graph backend with resident simulation, styled points/links, ' +
      'updates and picking before large-graph optimization.',
    'Validate host devices/passes, picking, state isolation, deck integration and position-resource exposure.'],
    evidence: [['point-capacity', 'Resident updates']],
  },
  {
    id: 'production',
    title: 'Production acceptance',
    position: 'Bounded local measurements available',
    acceptance: 'Agreed quality/performance budgets and native support matrix',
    gates: ['Agree representative workloads, quality, frame/update latency and peak-memory budgets.',
      'Verify intended native GPUs/browsers and unsupported-device behavior before switching production.'],
    evidence: [['gpu-stage-profile', 'Controlled profiling'], ['performance-lab', 'Isolated benchmarks']],
  },
] as const

export const mainOpenIssues = [
  { text: 'Complete production force/rendering coverage and the Graph/host contracts.', href: '#/feature-inventory' },
  { text: 'Establish larger graph behavior and an affordable precision policy.', href: '#/roadmap?section=milestone-simulation' },
  { text: 'Agree quality, latency/memory budgets and the intended native GPU/browser matrix.', href: '#/roadmap?section=milestone-production' },
] as const

// Current editorial priority. The gate and findings come from the same records
// used by Roadmap and the experiment page, never from this browser's live run.
export const migrationFocus = {
  milestone: 'rendering',
  experiment: 'straight-links',
  phase: 'Prototype validation',
  status: 'Production Cosmos uses WebGL. Integration and production acceptance remain open.',
  demonstrated: ['collision', 'matched-layout', 'point-styling'],
} as const
