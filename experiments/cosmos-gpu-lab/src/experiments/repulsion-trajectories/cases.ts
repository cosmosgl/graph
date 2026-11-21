import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'trajectory-drift',
  title: 'Follow repulsion trajectories',
  kind: 'compare',
  question: 'How far apart do independently evolving repulsion calculations move?',
  description: 'WebGL, two WebGPU paths and a CPU start from the same 512 points, then retain their own positions.',
  tryIt: 'Press Run 20 ticks to compare each local check with the accumulated position drift.',
  reference: 'An independently evolving CPU trajectory and same-input CPU checks for each GPU tick.',
  acceptance: 'Local force and position checks use the existing tolerance. Drift is descriptive and has no pass threshold.',
  recorded: {
    conclusion: 'Corrected WebGPU passed local checks in four recorded cases, but the coincident input still developed substantial trajectory drift.',
    date: 'Not recorded',
    environment: 'Apple M3, standalone Chrome, luma 10.0.0-alpha.4.',
    scope: 'Four repulsion-only fixtures over 20 independently evolving ticks.',
    limits: 'The dense WebGL controls had local failures. Repulsion-only motion does not establish final layout quality.',
    evidence: [{ label: 'Trajectory evidence and method', page: 'findings' }],
  },
}]
