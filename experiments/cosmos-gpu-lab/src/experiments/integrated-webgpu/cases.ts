import type { ExperimentCase } from '../../runtime/experiment'
import type { ResultChart } from '../../runtime/result-chart'

export const karateFitChart: ResultChart = {
  title: 'Fit brought all 34 points back into view',
  context: 'Visible point centers · Same Karate Club layout at tick 5,000',
  unit: 'of 34',
  bars: [['Original camera', 17], ['After Fit', 34]],
}

export const cases: ExperimentCase[] = [
  {
    id: 'integrated-graph',
    title: 'Explore the integrated WebGPU graph',
    kind: 'explore',
    question: 'Can one WebGPU graph simulate, draw and respond to interaction?',
    description: 'This 1,024-point graph combines the core forces with circles, straight links and point picking.',
    tryIt: 'Press Run to start the layout, then select a point. The graph highlights it in yellow.',
    reference: 'The recorded evaluation checks sampled pixels, point identity and complete-frame and interaction timing.',
    acceptance: 'The live graph is an exploratory session. Its appearance alone does not establish the recorded timing or pixel checks.',
    recorded: {
      conclusion: 'The initial 1,024-point chain met the recorded frame and pick targets; larger workloads did not all pass.',
      date: '2026-11-17',
      environment: 'Apple M3, inline Chromium 157, luma 10.0.0-alpha.15.',
      scope: 'A 300-frame window, sampled rendering and bounded picking and dragging on the initial graph matrix.',
      limits: 'One device and a limited feature set; later interaction outliers and the 8,192-point star remain unresolved.',
      evidence: [
        { label: 'Pilot evidence overview', page: 'overview' },
        { label: 'Integrated graph evidence', page: 'findings' },
        { label: 'Interactive composed forces', page: 'composed-interaction' },
        { label: 'Evaluation scope', page: 'method' },
      ],
    },
  },
  {
    id: 'cooled-karate-picking',
    title: 'Picking a cooled Karate Club graph',
    kind: 'recorded',
    question: 'Can every point in the cooled graph be found and picked within the timing target?',
    description: 'This recorded assessment fits the 34-point Karate Club graph and checks each visible point.',
    reference: 'The recorded point IDs and a 50 ms maximum picking-feedback target.',
    acceptance: 'Every sampled point must return its expected ID and complete within the target.',
    recorded: {
      conclusion: 'All points were visible and pickable after Fit, but one pick took 68.2 ms. A later replay passed without explaining the failure.',
      date: '2026-11-18',
      environment: 'Apple M3, inline Chromium 157, luma 10.0.0-alpha.15.',
      scope: 'The cooled 34-point graph and a subsequent 102-pick replay on the same saved geometry.',
      limits: 'The original timing failure remains unresolved; physical display latency and other devices were not measured.',
      evidence: [{ label: 'Cooled graph assessment', page: 'findings', section: 'cooled-karate-club-readability-and-exploration' }],
      charts: [karateFitChart],
    },
  },
  {
    id: 'shared-device-recovery',
    title: 'Share a GPU device and recover',
    kind: 'recorded',
    question: 'Can a host keep its GPU device and restore positions after the layout is destroyed?',
    description: 'A separate host prototype draws from a borrowed layout buffer, then recreates the layout from a checkpoint.',
    reference: 'Known marker pixels, tracked resource cleanup and saved point positions.',
    acceptance: 'The host must remain usable after layout cleanup; restored positions and the next checked gravity step must match.',
    recorded: {
      conclusion: 'The host kept drawing after layout cleanup, and a new device restored all 128 saved position values exactly.',
      date: '2026-11-19',
      environment: 'Apple M3, visible Chrome 157, luma 10.0.0-alpha.15.',
      scope: 'A 32-point chain, one planned device loss and a manual checkpoint restart.',
      limits: 'This prototype tests a manual restart. The linked host evidence covers GPU-process loss and recovery in the packed Deck app.',
      evidence: [{ label: 'Shared-device and recovery evidence', page: 'host-ownership' }],
    },
  },
  {
    id: 'tracked-positions',
    title: 'Read selected moving positions',
    kind: 'recorded',
    question: 'Can a tracker read only its requested point positions from the GPU?',
    description: 'A GPU gather reads a compact snapshot for selected IDs while the layout remains resident.',
    reference: 'The corresponding positions from the test fixture and the live GPU position buffer.',
    acceptance: 'Requested coordinates and ID order must match exactly, including missing IDs and overlapping requests.',
    recorded: {
      conclusion: 'All eight recorded requests matched exactly, including overlapping snapshots and a request crossing a workgroup boundary.',
      date: '2026-11-19',
      environment: 'Apple M3, visible Chrome 157, luma 10.0.0-alpha.15.',
      scope: 'A 257-point chain with availability changes, shrink and regrowth.',
      limits: 'The synchronous production tracker contract and end-to-end label latency remain unresolved.',
      evidence: [
        { label: 'Tracked position evidence', page: 'tracked-points' },
        { label: 'Live graph readback', page: 'readback' },
      ],
    },
  },
]
