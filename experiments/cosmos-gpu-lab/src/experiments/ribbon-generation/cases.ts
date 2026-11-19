import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'compute-cache',
  title: 'Does a compute cache speed up curved links?',
  kind: 'recorded',
  question: 'Can generating curve samples once on the GPU reduce the cost of drawing links?',
  description: 'This stopped investigation compared generating each ribbon in the vertex shader with a reusable compute cache.',
  reference: 'The existing vertex-generation path is the cost and pixel-preservation control.',
  acceptance: 'A candidate must preserve the checked color and ID bytes and demonstrate a consistent cost benefit.',
  recorded: {
    conclusion: 'The rebuilt cache did not show a consistent benefit; a short-curve case also changed two color pixels.',
    date: '2026-11-16',
    environment: 'Native Apple WebGPU adapter, Metal 3, Chromium 157; exact chip not exposed.',
    scope: 'Six frozen workloads repeated twice, including color and picking checks.',
    limits: 'One adapter and selected frozen workloads; timing sensitivity and the pixel difference remain unresolved.',
    evidence: [{ label: 'Compute-cache evidence', page: 'case-evidence' }],
  },
}]
