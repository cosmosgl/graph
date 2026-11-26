import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'workgroup-memory',
  title: 'Compare workgroup repulsion',
  kind: 'compare',
  question: 'Can a small workgroup buffer preserve the hierarchical repulsion result?',
  description: 'The WebGPU panel starts with the workgroup-memory method; WebGL and CPU use the same points.',
  tryIt: 'Start with 8,192 uniform points and select Step + validate. Inspect the force and position checks.',
  reference: 'The hierarchical WebGL and CPU models are controls; the recorded study also compared stored WebGPU contributions.',
  acceptance: 'The existing structure, force and integration checks remain unchanged.',
  recorded: {
    conclusion: 'Both workgroup variants matched stored force and position bits and passed the CPU checks on the frozen cases.',
    date: '2026-11-18',
    environment: 'Apple M3, visible Chrome, luma.gl 10.0.0-alpha.15.',
    scope: 'Uniform and clustered inputs at 8,192 and 16,384 points, with eight samples and the precise shell.',
    limits: 'These bounded same-input checks do not establish full-graph performance or broader device support.',
    evidence: [{ label: 'Workgroup-memory evidence', page: 'case-evidence' }],
  },
}]
