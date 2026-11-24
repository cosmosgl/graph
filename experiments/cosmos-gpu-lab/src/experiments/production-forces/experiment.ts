import { defineExperiment } from '../../runtime/experiment'
import { forceCases, forces, type ForceCase } from './fixture'

const descriptions: Record<ForceCase, string> = {
  combined: 'Follow an overlapping pair and weighted links through eight updates. Click either graph to see which object moved under the pointer.',
  gravity: 'Pull each free point toward the fixed world origin.',
  center: 'Pull each free point toward the centroid of the present points.',
  springs: 'Connect endpoints using unequal weights, including a zero-weight spring and an absent endpoint.',
  mouse: 'Hold the right button for four updates, alternating a manual step and a paused frame. Release it for the next four.',
  attractors: 'Give points individual targets and weights, including a missing target and a disabled attractor.',
  clusters: 'Pull one group toward its live centroid and another toward a fixed target. Leave one point unassigned.',
  repulsion: 'Advance seven present points with the exact all-pairs simulation.',
  hierarchy: 'Spread 8,191 present points with hierarchical repulsion and follow their motion through cooling.',
}

export const experiment = defineExperiment({
  id: 'production-forces',
  title: 'Forces in the Cosmos packages',
  summary: 'Compare point positions from the same force simulation in the WebGL and WebGPU Graph packages.',
  tags: ['forces', 'simulation', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  caseChooserLabel: 'Force',
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Both graphs start paused with the same coordinates, seed and camera. ' +
    'The orange point in the small fixtures is pinned. Each update reads back the positions from both packages.',
  },
  cases: forceCases.map(id => ({
    id,
    title: forces[id],
    kind: 'compare',
    question: id === 'combined'
      ? 'Does a link draw and pick at its new position when three forces move its endpoints?'
      : id === 'hierarchy'
        ? 'How closely do both layouts spread and settle under hierarchical repulsion?'
        : `How closely do the two packages move points under ${forces[id].toLowerCase()}?`,
    description: descriptions[id],
    reference: 'The workspace WebGL Graph runs the same public API calls.',
    acceptance: id === 'hierarchy'
      ? 'Both layouts expand and settle. Their radii and RMS position difference agree to within 5% of the WebGL radius.'
      : 'The pinned point and absent slot are preserved. Every live coordinate agrees within 0.01 graph units at ticks 0, 1, 4 and 8.',
    recorded: {
      date: '2026-11-24',
      environment: 'Chrome on Apple M3 and SwiftShader',
      scope: id === 'hierarchy' ? '8,192 slots through 32 ticks' : 'Eight slots through eight ticks',
      conclusion: id === 'hierarchy'
        ? 'The layouts settled with an RMS position difference below 1% of the WebGL radius.'
        : 'Both packages met the movement and coordinate checks.',
      limits: 'One seeded layout and one force configuration.',
      evidence: [{ label: 'Package force measurements', page: 'results' }],
    },
  })),
  create: async (host, caseId) => (await import('./view')).createForcesView(host, caseId),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Force comparison method', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'results', title: 'Package force measurements', load: async (): Promise<string> => (await import('./results.md?raw')).default },
  ],
})
