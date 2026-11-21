import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'hierarchical-repulsion',
  title: 'Compare hierarchical repulsion',
  kind: 'compare',
  question: 'How closely does the WebGPU hierarchy reproduce the same repulsion calculation?',
  description: 'WebGL, WebGPU and a CPU model use the same input points and neighbor-sampling policy.',
  tryIt: 'Start with 8,192 uniform points and select Step + validate. Compare the structure, force and position checks.',
  reference: 'The CPU compatibility model checks the hierarchy, sampled neighbors, forces and integration.',
  acceptance: 'Structural identities and existing numerical gates are checked separately from approximation error.',
  recorded: {
    conclusion: 'Two stored-contribution variants passed the checked dense cases after midpoint rounding was corrected.',
    date: '2026-11-16',
    environment: 'Apple M3 inline browser and Linux Chromium 151 SwiftShader.',
    scope: '8,192 and 16,384 clustered points over three CPU-anchored ticks.',
    limits: 'The default inline variant remains unchanged; the recorded correction does not establish long independent trajectories.',
    evidence: [
      { label: 'Dense far-field evidence', page: 'case-evidence' },
      { label: 'Precision and storage evidence', page: 'precision-cost', section: 'preserving-precision-with-less-memory' },
    ],
  },
}]
