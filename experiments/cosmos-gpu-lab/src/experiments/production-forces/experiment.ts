import { defineExperiment, type ExperimentCase } from '../../runtime/experiment'
import { forceCases, forces, type ForceCase } from './fixture'
import { isScaleCase } from './scale-fixture'

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
  dense: 'Step eight dense communities through weighted springs, repulsion and collision. Follow their spread and click a point or link.',
  hubs: 'Follow a movable hub as more than a thousand links pull on it. Compare its layout and click targets through tick 100.',
}

function forceCase (id: ForceCase): ExperimentCase {
  const base = {
    id,
    title: forces[id],
    kind: 'compare' as const,
    description: descriptions[id],
    reference: 'The workspace WebGL Graph runs the same public API calls.',
  }
  if (isScaleCase(id)) {
    return {
      ...base,
      question: id === 'dense'
        ? 'Do the eight communities stay together as both graphs settle?'
        : 'How do both graphs settle around the same movable hub?',
      acceptance: 'Preserve pins, absent slots and click IDs. Compare community retention, spring lengths and overlap through tick 100.',
      tryIt: 'Step once, then click the gold link between communities or its lilac endpoint. Each preview shows the ID returned by its Graph.',
      evidence: [{ label: 'Dense and hub comparison method', page: 'scale-method' }],
      recorded: {
        date: '2026-11-24',
        environment: 'Chrome on native Apple M3',
        scope: '8,192 slots, nine layout checkpoints and two timed comparison pairs',
        conclusion: id === 'dense'
          ? 'RMS position error peaked at 0.22% of the WebGL radius. Frame and click p95 were within the M3 margins.'
          : 'RMS position error peaked at 0.44% of the WebGL radius. The hub retained more overlap on WebGPU. Both timing checks passed.',
        limits: 'One seed per topology. Moving click timings cover the isolated pin and background.',
        evidence: [{ label: 'Package force measurements', page: 'results' }, { label: 'M3 frame and click timings', page: 'scale-timing' }],
      },
    }
  }
  return {
    ...base,
    question: id === 'combined'
      ? 'Does a link draw and pick at its new position when three forces move its endpoints?'
      : id === 'hierarchy'
        ? 'How closely do both layouts spread and settle under hierarchical repulsion?'
        : `How closely do the two packages move points under ${forces[id].toLowerCase()}?`,
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
  }
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
  cases: forceCases.map(forceCase),
  create: async (host, caseId) => (await import('./view')).createForcesView(host, caseId),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Force comparison method', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    {
      kind: 'markdown',
      id: 'scale-method',
      title: 'Dense and hub comparison method',
      load: async (): Promise<string> => (await import('./scale-method.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'scale-timing',
      title: 'M3 frame and click timings',
      load: async (): Promise<string> => (await import('./scale-timing.md?raw')).default,
    },
    { kind: 'markdown', id: 'results', title: 'Package force measurements', load: async (): Promise<string> => (await import('./results.md?raw')).default },
  ],
})
