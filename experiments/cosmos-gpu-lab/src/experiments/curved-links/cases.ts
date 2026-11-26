import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'curve-comparison',
  title: 'Compare curved links',
  kind: 'compare',
  question: 'Do WebGL and WebGPU draw and pick the same solid curves?',
  description: 'Inspect the link under a pixel in either preview.',
  tryIt: 'Choose Folded ribbon and compare Both faces with Drawn faces.',
  reference: 'Production WebGL geometry and an independent CPU calculation of the painted pixels and picked IDs.',
  acceptance: 'Exact picked IDs and CPU masks, colors within 2/255, and visible sources for drawn-face picks.',
  recorded: {
    conclusion: 'Drawn-face picking passed all strict checks in 28 of 64 solid curve cases on Apple M3.',
    date: '2026-11-23',
    environment: 'Chrome 157, Apple M3 (Metal WebGL, Apple WebGPU), luma.gl 10.0.0-alpha.15.',
    scope: 'Frozen solid curves across widths, geometry, zoom, pixel ratio and opacity.',
    limits: 'Moving curves and other GPUs remain open.',
    evidence: [{ label: 'Automated test results', page: 'automated-cases' }, { label: 'Recorded curve checks', page: 'case-evidence' }],
  },
}]
