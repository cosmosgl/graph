import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'exact-repulsion',
  title: 'Compare exact repulsion',
  kind: 'compare',
  question: 'Do WebGL and WebGPU calculate the same all-pairs repulsion?',
  description: 'The backends calculate forces for the same points, with an independent CPU calculation as a control.',
  tryIt: 'Start with 128 uniform points and select Step + validate to compare one force and position update.',
  reference: 'An independently coded CPU pair traversal and integration model supplies the float32 compatibility reference.',
  acceptance: 'The force and position checks use the existing tolerances. Independent trajectory drift is reported separately.',
  recorded: {
    conclusion: 'Same-input checks passed on the recorded fixtures; independently evolving coincident points diverged by the second tick.',
    date: '2026-11-09',
    environment: 'Apple M3, Chromium 157, ANGLE Metal WebGL and Apple WebGPU.',
    scope: 'Exact all-pairs force, shared-input correctness and bounded independent trajectories.',
    limits: 'Same-input compatibility does not establish long-term layout quality or full-graph performance.',
    evidence: [{ label: 'Exact repulsion evidence', page: 'case-evidence' }],
  },
}]
