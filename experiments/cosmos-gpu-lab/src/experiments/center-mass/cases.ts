import type { ExperimentCase, SinglePageCase } from '../../runtime/experiment'

export const centerMassCase: ExperimentCase = {
  id: 'center-comparison',
  title: 'Center of mass',
  kind: 'compare',
  question: 'How closely do WebGL and WebGPU calculate the same center?',
  description: 'Both use the same 8,192 moving points. The CPU average is the reference.',
  tryIt: 'Press Step to move the points once. Compare how far each result is from the CPU center.',
  reference: 'WebGL adds positions into a texture with blending. WebGPU combines partial sums in two passes. The CPU averages the same coordinates.',
  acceptance: 'The errors are distances in world units from the CPU center. The exploratory comparison has no accuracy pass threshold.',
  recorded: {
    conclusion: 'Both centers were close to the CPU reference. The faster center force failed the strict position check on one moving graph.',
    date: '5 and 18 November 2026',
    environment: 'Chromium on macOS for the initial comparison and Apple M3 with Chrome 157 for the follow-up measurements.',
    scope: 'Moving centers, frozen force timings, and two independently evolving community graphs.',
    limits: 'The timing and trajectory studies covered one device. Full-frame cost and broader layouts remain open.',
    evidence: [
      { label: 'Initial correctness findings', page: 'results' },
      { label: 'Center-force measurement evidence', page: 'cost-evidence' },
      { label: 'Calculate the center once', page: 'once-findings' },
      { label: 'Center-force trajectory evidence', page: 'trajectory-evidence' },
    ],
  },
}

/* eslint-disable @typescript-eslint/naming-convention -- Aliases are public URL slugs. */
export const centerMassPage: SinglePageCase = {
  observations: [
    {
      id: 'center-accuracy',
      title: 'Center accuracy',
      date: '5 November 2026',
      evidence: 'The recorded center errors were 2.124e−9 world units for WebGL and 3.252e−10 for WebGPU.',
      limits: 'One exploratory Chromium run on macOS with 8,192 moving points. There was no accuracy threshold or controlled speed comparison.',
    },
    {
      id: 'center-force-cost',
      title: 'Center-force cost',
      date: '18 November 2026',
      evidence: 'At 8,192 points, the existing force took 4.802 ms and the linear candidate took 0.012 ms. ' +
        'Frozen force checks passed through 4,194,240 points.',
      limits: 'Medians from seven isolated GPU samples on one Apple M3. Complete interactive frames were outside the measurement.',
    },
    {
      id: 'center-trajectories',
      title: 'Force and trajectories',
      date: '18 November 2026',
      evidence: 'The 512-point graph passed every checkpoint. The 8,192-point graph failed the strict position comparison from tick 10. ' +
        'By tick 200, 1,103 coordinate components exceeded tolerance.',
      limits: 'Two independently evolving community graphs over 200 ticks on one Apple M3.',
    },
    {
      id: 'center-once',
      title: 'Calculate the center once',
      date: '18 November 2026',
      evidence: 'At one million points, calculating the center per point took 2.431 ms and calculating it once took 2.447 ms.',
      limits: 'The paired GPU timings varied from −0.201 to +0.105 ms on one device, leaving the speed difference inconclusive.',
    },
  ],
  legacyCases: {
    'center-measurements': 'run-diagnostics',
    'center-force-scale': 'center-trajectories',
  },
  pageSections: {
    'cost-evidence': 'center-force-cost',
    'trajectory-evidence': 'center-trajectories',
    overview: 'case-comparison',
    algorithm: 'case-comparison',
    implementation: 'case-comparison',
    correctness: 'center-accuracy',
    results: 'center-accuracy',
    performance: 'center-force-cost',
    'scale-method': 'run-diagnostics',
    'scale-findings': 'center-force-cost',
    'once-findings': 'center-once',
    limitations: 'recorded-findings',
    references: 'case-comparison',
    'validation-contract': 'case-comparison',
  },
}
/* eslint-enable @typescript-eslint/naming-convention */
