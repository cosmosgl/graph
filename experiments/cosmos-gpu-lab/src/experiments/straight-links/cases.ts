import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'straight-comparison',
  title: 'Compare straight links',
  kind: 'compare',
  question: 'Do WebGL and WebGPU draw and pick the same straight links?',
  description: 'Draw the same frozen links on both backends and compare their colors and picked IDs.',
  tryIt: 'Start with the solid ribbon fixture and select Compare. Inspect the two images and the checks below them.',
  reference: 'Production WebGL and an independent scalar mask are controls for the WebGPU rendering and picking candidate.',
  acceptance: 'Color, visibility and picking checks are reported separately. Edge mismatches remain failures.',
  recorded: {
    conclusion: 'On one GPU, 14 of 24 dashed and dotted cases passed; boundary failures kept the candidate from passing the full check.',
    date: '2026-11-17',
    environment: 'Apple M3, Chromium 157, luma.gl 10.0.0-alpha.15.',
    scope: 'Frozen line fixtures, including patterns, color and picking checks.',
    limits: 'One device and selected fixtures; the result does not approve all line rendering or picking.',
    evidence: [{ label: 'Straight-link evidence', page: 'case-evidence' }],
  },
}]
