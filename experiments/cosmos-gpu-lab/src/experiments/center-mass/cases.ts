import type { ExperimentCase } from '../../runtime/experiment'

export const centerMassCases: ExperimentCase[] = [
  {
    id: 'center-comparison',
    title: 'Compare center-of-mass calculations',
    kind: 'compare',
    question: 'How closely do WebGL and WebGPU calculate the same center?',
    description: 'Both GPUs calculate the average position of the same 8,192 moving points. A CPU average is the reference.',
    tryIt: 'Press Step to advance the points once and compare each GPU’s error, or Play to watch the shared input move.',
    reference: 'The CPU averages the uploaded point coordinates using JavaScript double-precision arithmetic.',
    acceptance: 'The displayed errors are distances from the CPU center. This demo has no agreed pass threshold.',
    recorded: {
      conclusion: 'Both GPU centers were close to the CPU average in the initial exploratory comparison.',
      date: '2026-11-05',
      environment: 'macOS Chromium; exact GPU and browser version were not recorded.',
      scope: '8,192 moving points, with GPU results read back each tick.',
      limits: 'One exploratory run; no agreed accuracy budget or controlled speed comparison.',
      evidence: [{ label: 'Initial center comparison', page: 'results' }, { label: 'How the comparison works', page: 'overview' }],
    },
  },
  {
    id: 'center-measurements',
    title: 'Measure center-force cost',
    kind: 'measure',
    question: 'How much GPU work do the center and force calculations take?',
    description: 'Run a new local measurement of center-force variants, or compare calculating the center once with calculating it per point.',
    tryIt: 'Start with 8,192 points and run the scale study. Keep the tab visible until it finishes.',
    reference: 'The scale study compares the GPU center with a CPU sum and checks the linear force against the current force.',
    acceptance: 'Counts and named numerical checks are reported separately from GPU timings; there is no performance pass threshold.',
    recorded: {
      conclusion: 'At 8,192 points on M3, the existing force took 4.802 ms and the linear candidate took 0.012 ms in isolated GPU measurements.',
      date: '2026-11-18',
      environment: 'Apple M3, visible Chrome 157, luma.gl 10.0.0-alpha.15.',
      scope: 'One offset distribution through 4,194,240 points, with bounded graph and paired timing studies.',
      limits: 'One device and input distribution. Isolated GPU work is not complete-frame responsiveness or proof of trajectory equivalence.',
      evidence: [{ label: 'Center-force measurement evidence', page: 'cost-evidence' }],
    },
  },
  {
    id: 'center-force-scale',
    title: 'Center-force scaling and trajectories',
    kind: 'recorded',
    question: 'Can a faster center force preserve graph trajectories as the input grows?',
    description: 'This recorded study examines a recursive center calculation and an optional linear force on moving graphs.',
    reference: 'The current center-force shader and independently evolving graph trajectories are the comparison controls.',
    acceptance: 'Frozen force components use the existing absolute and relative tolerance; ' +
      'trajectories use the existing strict position checks.',
    recorded: {
      conclusion: 'The linear candidate passed the frozen force checks, but its 8,192-point independently evolving graph ' +
        'failed the strict trajectory comparison.',
      date: '2026-11-18',
      environment: 'Apple M3, visible Chrome 157, luma.gl 10.0.0-alpha.15.',
      scope: 'Two independently evolving community graphs of 512 and 8,192 points, checked over 200 ticks, plus frozen-input force checks.',
      limits: 'One native device and limited graph inputs; the candidate is not yet a production replacement.',
      evidence: [{ label: 'Center-force trajectory evidence', page: 'trajectory-evidence' }],
    },
  },
]
