import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'local-neighbors',
  title: 'Compare local repulsion',
  kind: 'compare',
  question: 'Does a spatial grid find the same nearby forces as checking every pair?',
  description: 'Both WebGPU panels move the same points using repulsion within a fixed radius.',
  tryIt: 'Start with 1,024 uniform points. Select Step to move them, then Validate next step to check the forces.',
  reference: 'An independent CPU all-pairs calculation checks neighbor counts and forces for the selected targets.',
  acceptance: 'Neighbor counts must match exactly; force, velocity and position use the existing tolerances.',
  recorded: {
    conclusion: 'The corrected baseline and chunked traversal passed the recorded checks; chunking helped dense cases but slowed a smaller case.',
    date: 'Not recorded',
    environment: 'Native Apple / Metal 3 adapter, Chrome 156.',
    scope: 'Paired dense, sparse and small fixed-radius inputs; 72 initial and 18 evolved checks.',
    limits: 'One device and selected target populations; this is local repulsion with its own integrator, not the full graph layout.',
    evidence: [{ label: 'Local repulsion evidence', page: 'case-evidence' }],
  },
}]
