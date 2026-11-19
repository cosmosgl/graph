import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'curve-comparison',
  title: 'Compare curved links',
  kind: 'compare',
  question: 'Do WebGL and WebGPU draw and pick the same curved links?',
  description: 'Draw the same frozen curves on both backends and compare their colors and picked IDs.',
  tryIt: 'Start with the solid bows fixture and select Compare. Inspect the two images and the checks below them.',
  reference: 'Production WebGL and an independent triangle-strip mask are controls for the WebGPU candidate.',
  acceptance: 'Color, source visibility and picking checks are reported separately. Boundary mismatches remain failures.',
  recorded: {
    conclusion: 'On one GPU, dashed and dotted curves preserved color and source visibility. Only 4 of 24 cases passed all gates; all four had zero opacity.',
    date: '2026-11-17',
    environment: 'Apple M3, Chromium 157, luma.gl 10.0.0-alpha.15.',
    scope: 'Frozen curved-link pattern fixtures and the recorded color and picking gates.',
    limits: 'One device and selected curves; preserving color alone does not establish matching picking.',
    evidence: [{ label: 'Curved-link evidence', page: 'case-evidence' }],
  },
}]
