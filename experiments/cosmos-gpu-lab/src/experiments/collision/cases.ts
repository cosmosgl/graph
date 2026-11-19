import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [
  {
    id: 'collision-comparison',
    title: 'Compare collision corrections',
    kind: 'compare',
    question: 'Do WebGL and WebGPU separate overlapping points in the same way?',
    description: 'The same 128-point input is stepped through the small-graph collision calculation, with the targeted WebGPU correction and a CPU reference.',
    tryIt: 'Press Step to see the points move and compare the force and position checks.',
    reference: 'Production WebGL collision and an independent float32 CPU model.',
    acceptance: 'The displayed force and position checks use the existing tolerances; fixed and absent points must retain their state.',
    recorded: {
      conclusion: 'A targeted WebGPU correction passed all 1,700 tick checks and 1,700 trajectory checks in the recorded matrix.',
      date: '2026-11-12',
      environment: 'Apple M3, inline Chromium 157, luma 10.0.0-alpha.4.',
      scope: 'The small-graph collision path and selected independently evolving layouts.',
      limits: 'The native arithmetic failure remains a control. This does not establish behavior for other devices or the large-graph path.',
      evidence: [{ label: 'Collision correction evidence', page: 'precision' }, { label: 'How collision is compared', page: 'method' }],
    },
  },
  {
    id: 'large-collision',
    title: 'Collision above 4,096 points',
    kind: 'recorded',
    question: 'Does the hashed collision path select the same neighbors as the CPU?',
    description: 'This recorded study checks the separate hash-and-slot path used above the small-graph cutoff.',
    reference: 'An independent CPU model of the hash buckets, selected slots, collision force and positions.',
    acceptance: 'CPU slot IDs and positions are compared exactly; forces and WebGL comparisons use the recorded component tolerances.',
    recorded: {
      conclusion: 'All nine WebGPU passes matched the CPU slot IDs and positions. In a separate comparison, WebGL and WebGPU selected ' +
        'identical slots and passed the force and position checks.',
      date: '2026-11-19',
      environment: 'Apple M3, native Chrome 157, luma 10.0.0-alpha.15.',
      scope: 'Nine isolated passes at 4,097 and 8,192 points, including an overloaded bucket and a hash-boundary case.',
      limits: 'Force and position comparisons use the existing tolerance. Sustained dense layouts, presentation cost and other devices remain open.',
      evidence: [{ label: 'Hashed collision evidence', page: 'hashed-findings' }, { label: 'Hash and slot method', page: 'hashed-method' }],
    },
  },
]
