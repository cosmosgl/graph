import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'straight-comparison',
  title: 'Compare straight links',
  kind: 'compare',
  question: 'Do WebGL and WebGPU draw and pick the same straight links?',
  description: 'Draw the same frozen links on both backends and compare their colors and picked IDs.',
  tryIt: 'Choose Overlap and Cosmos (+5 CSS px), then inspect a pixel just outside a visible link.',
  reference: 'Production WebGL and an independent scalar mask are controls for the WebGPU rendering and picking candidate.',
  acceptance: 'Solid ribbons require exact IDs and colors within 2/255 outside the one-device-pixel edge band. Thin links must stay visible.',
  recorded: {
    conclusion: 'All seven practical solid-link checks passed on Apple M3. The diagonal differences stayed within one device pixel of its outline.',
    date: '2026-11-23',
    environment: 'Apple M3, Chromium 157, luma.gl 10.0.0-alpha.15.',
    scope: 'Frozen solid links with hard and blended edges, width limits, hidden links, overlap and picking policies.',
    limits: 'One device and selected fixtures; the result does not approve all line rendering or picking.',
    evidence: [{ label: 'Automated test results', page: 'automated-cases' }],
  },
}]
