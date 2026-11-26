import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'pointer-force',
  title: 'Compare pointer repulsion',
  kind: 'compare',
  question: 'Does a pointer push points the same way in WebGL and WebGPU?',
  description: 'Two paused 256-point previews apply the pointer force without running the rest of the simulation.',
  tryIt: 'Press Step and check for one push, or hold the right mouse button over either preview to move the points.',
  reference: 'Production WebGL mouse force and an independent CPU force and integration calculation.',
  acceptance: 'Forces and positions use the existing numerical tolerance; pinned and absent point state must remain exact.',
  recorded: {
    conclusion: 'The isolated pointer-force checks passed through 8,192 points, including release and operation while paused.',
    date: '2026-11-19',
    environment: 'Apple M3, visible Chrome 157, luma 10.0.0-alpha.15.',
    scope: '34 backend rows and 32 trajectory checkpoints, including pointer mapping, pan and zoom.',
    limits: 'This does not measure end-to-end input latency or establish combined-force behavior on other devices.',
    evidence: [{ label: 'Pointer-force evidence', page: 'findings' }, { label: 'How pointer repulsion works', page: 'method' }],
  },
}]
