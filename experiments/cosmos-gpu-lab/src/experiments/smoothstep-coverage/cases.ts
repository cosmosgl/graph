import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'line-edge',
  title: 'Why a line edge changes',
  kind: 'compare',
  question: 'Does changing the edge formula make WebGL and WebGPU draw the same line?',
  description: 'Compare both formulas on the same line in WebGL and WebGPU.',
  reference: 'Both renderers receive the same line and evaluate both edge formulas; a fixed-input check isolates the formula.',
  acceptance: 'The result reports changed colors and IDs; it does not relax the existing pixel checks.',
  recorded: {
    conclusion: 'Changing the formula changed no pixels on either backend; the hard-edged line still differed at 180 pixel IDs.',
    date: '2026-11-17',
    environment: 'Apple M3, Chromium 157, luma.gl 10.0.0-alpha.15.',
    scope: 'One frozen line, the original hard edge and a small shifted blended control.',
    limits: 'This does not establish behavior for every line, device or compiler.',
    evidence: [
      { label: 'Full evidence', page: 'findings' },
      { label: 'Comparison method', page: 'method' },
      { label: 'Line-edge summary', page: 'case-evidence' },
    ],
  },
}]
